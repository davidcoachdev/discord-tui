import type { ClientProps } from "../client-props/props";
import { log } from "../log/logger";
import type { Secret } from "../secret";
import { buildIdentify } from "./identify";
import { createZlibStreamInflater } from "./inflate";

export type GatewayStatus = "connecting" | "identifying" | "ready" | "resuming" | "reconnecting" | "disconnected";
export type SessionKind = "identified" | "resumed";

export interface Gateway {
  connect(): void;
  close(): void;
  send(op: number, d: unknown): void;
  readonly status: GatewayStatus;
  readonly sessionId: string | null;
  readonly resumeGatewayUrl: string | null;
  readonly seq: number | null;
  on(ev: "dispatch", fn: (t: string, d: any) => void): () => void;
  on(ev: "status", fn: (status: GatewayStatus) => void): () => void;
  on(ev: "session", fn: (kind: SessionKind) => void): () => void;
  on(ev: "fatal", fn: (reason: "unauthorized") => void): () => void;
}

export interface GatewayDeps {
  token: Secret;
  props: ClientProps;
  url?: string;
  WebSocketImpl?: typeof WebSocket;
  random?: () => number;
  setTimer?: typeof setTimeout;
}

const DEFAULT_URL = "wss://gateway.discord.gg/?v=9&encoding=json&compress=zlib-stream";
const SEND_LIMIT = 110;
const SEND_WINDOW_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

export function createGateway(deps: GatewayDeps): Gateway {
  const WebSocketImpl = deps.WebSocketImpl ?? WebSocket;
  const random = deps.random ?? Math.random;
  const setTimer = deps.setTimer ?? setTimeout;
  const url = deps.url ?? DEFAULT_URL;

  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  let socket: WebSocket | null = null;
  let status: GatewayStatus = "disconnected";
  let sessionId: string | null = null;
  let resumeGatewayUrl: string | null = null;
  let seq: number | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closedByUser = false;
  let resuming = false;
  let acked = true;
  let backoffIndex = 0;
  const sentAt: number[] = [];

  function emit(ev: string, ...args: unknown[]): void {
    for (const listener of listeners.get(ev) ?? []) listener(...args);
  }

  function setStatus(next: GatewayStatus): void {
    status = next;
    log.info("gateway.status", { state: next });
    emit("status", next);
  }

  function rawSend(payload: unknown): void {
    try {
      socket?.send(JSON.stringify(payload));
    } catch {
      // el socket ya estaba cerrado
    }
  }

  function send(op: number, d: unknown): void {
    const now = Date.now();
    while (sentAt.length > 0 && now - sentAt[0]! >= SEND_WINDOW_MS) sentAt.shift();
    if (sentAt.length >= SEND_LIMIT) {
      const wait = SEND_WINDOW_MS - (now - sentAt[0]!);
      setTimer(() => {
        sentAt.push(Date.now());
        rawSend({ op, d });
      }, wait);
      return;
    }
    sentAt.push(now);
    rawSend({ op, d });
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer !== null) {
      clearTimeout(heartbeatTimer);
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function heartbeatTick(): void {
    if (!acked) {
      log.error("gateway.heartbeat-miss");
      dropSocket(sessionId !== null && seq !== null ? "resume" : "identify");
      return;
    }
    acked = false;
    send(1, seq);
  }

  function startHeartbeat(interval: number): void {
    stopHeartbeat();
    if (!Number.isFinite(interval) || interval <= 0) return;
    acked = true;
    const jitter = Math.floor(interval * random());
    heartbeatTimer = setTimeout(() => {
      heartbeatTick();
      heartbeatTimer = setInterval(heartbeatTick, interval);
    }, jitter);
  }

  function resumeUrl(): string {
    const base = (resumeGatewayUrl ?? url).replace(/\?.*$/, "").replace(/\/+$/, "");
    return `${base}/?v=9&encoding=json&compress=zlib-stream`;
  }

  function scheduleReconnect(kind: "resume" | "identify", delayOverride?: number): void {
    if (closedByUser || reconnectTimer !== null) return;
    setStatus("reconnecting");

    const base = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** Math.min(backoffIndex, 5));
    backoffIndex = Math.min(6, backoffIndex + 1);
    const delay = delayOverride ?? Math.round(base * (0.8 + random() * 0.4));

    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      resuming = kind === "resume";
      openSocket(kind === "resume" ? resumeUrl() : url);
    }, delay);
  }

  function onDispatch(t: string, d: any, s: number | null): void {
    if (typeof s === "number") seq = s;
    log.info("gateway.dispatch", { t, seq: s ?? undefined });

    let sessionKind: SessionKind | null = null;
    if (t === "READY" && d && typeof d === "object") {
      sessionId = typeof d.session_id === "string" ? d.session_id : sessionId;
      resumeGatewayUrl = typeof d.resume_gateway_url === "string" ? d.resume_gateway_url : resumeGatewayUrl;
      backoffIndex = 0;
      setStatus("ready");
      sessionKind = "identified";
    } else if (t === "RESUMED") {
      backoffIndex = 0;
      setStatus("ready");
      sessionKind = "resumed";
    }

    emit("dispatch", t, d);
    if (sessionKind !== null) emit("session", sessionKind);
  }

  function handleMessage(raw: string): void {
    let message: any;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    switch (message.op) {
      case 10: {
        const interval = message.d?.heartbeat_interval ?? 0;
        if (resuming && sessionId !== null && seq !== null) {
          setStatus("resuming");
          send(6, { token: deps.token.reveal(), session_id: sessionId, seq });
        } else {
          resuming = false;
          setStatus("identifying");
          const identify = buildIdentify(deps.token, deps.props);
          send(2, identify.d);
        }
        startHeartbeat(interval);
        return;
      }
      case 11:
        acked = true;
        return;
      case 1:
        send(1, seq);
        return;
      case 7:
        log.info("gateway.reconnect-requested");
        dropSocket("resume");
        return;
      case 9: {
        const resumable = message.d === true;
        log.warn("gateway.invalid-session", { state: resumable ? "resumable" : "new" });
        if (!resumable) {
          sessionId = null;
          seq = null;
        }
        dropSocket(resumable ? "resume" : "identify", resumable ? undefined : 1_000 + Math.floor(random() * 4_000));
        return;
      }
      case 0:
        onDispatch(String(message.t), message.d, typeof message.s === "number" ? message.s : null);
        return;
      default:
        return;
    }
  }

  /**
   * Suelta el socket actual (sus eventos ya no cuentan) y programa una sola reconexión.
   * Antes se cerraba y además reconectaba onclose: quedaban dos sockets vivos a la vez.
   */
  function dropSocket(kind: "resume" | "identify", delay?: number): void {
    stopHeartbeat();
    const current = socket;
    socket = null;
    resuming = false;
    try {
      current?.close(4000);
    } catch {
      // ya estaba cerrado
    }
    scheduleReconnect(kind, delay);
  }

  function handleClose(code: number): void {
    stopHeartbeat();
    socket = null;
    resuming = false;
    log.warn("gateway.closed", { close_code: code });
    if (reconnectTimer !== null) return;

    if (closedByUser) {
      setStatus("disconnected");
      return;
    }
    if (code === 4004) {
      log.error("gateway.fatal", { close_code: code });
      setStatus("disconnected");
      emit("fatal", "unauthorized");
      return;
    }
    if (code === 4007 || code === 4009) {
      sessionId = null;
      seq = null;
      scheduleReconnect("identify");
      return;
    }
    scheduleReconnect(sessionId !== null && seq !== null ? "resume" : "identify");
  }

  function openSocket(target: string): void {
    // Un contexto zlib por socket: si dos sockets compartieran uno, se corrompe ("unknown compression method").
    const own = createZlibStreamInflater();
    setStatus(resuming ? "resuming" : "connecting");
    const ws = new WebSocketImpl(target);
    socket = ws;

    ws.onmessage = (event: MessageEvent) => {
      if (socket !== ws) return; // un socket viejo que todavía manda algo
      let text: string | null;
      if (typeof event.data === "string") {
        text = event.data;
      } else {
        const bytes = toBytes(event.data);
        try {
          text = bytes === null ? null : own.push(bytes);
        } catch (error) {
          log.error("gateway.inflate-failed", { error_name: error instanceof Error ? error.name : "unknown" });
          dropSocket(sessionId !== null && seq !== null ? "resume" : "identify");
          return;
        }
      }
      if (text !== null) handleMessage(text);
    };
    ws.onclose = (event: CloseEvent) => {
      if (socket === ws) handleClose(event.code);
    };
    ws.onerror = () => {
      // el cierre llega por onclose
    };
  }

  return {
    connect(): void {
      if (socket !== null || reconnectTimer !== null) return;
      closedByUser = false;
      backoffIndex = 0;
      resuming = false;
      openSocket(url);
    },
    close(): void {
      closedByUser = true;
      stopHeartbeat();
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const current = socket;
      socket = null;
      try {
        current?.close(1000);
      } catch {
        // ya estaba cerrado
      }
      if (status !== "disconnected") setStatus("disconnected");
    },
    send,
    get status() {
      return status;
    },
    get sessionId() {
      return sessionId;
    },
    get resumeGatewayUrl() {
      return resumeGatewayUrl;
    },
    get seq() {
      return seq;
    },
    on(ev: string, fn: (...args: any[]) => void): () => void {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev)!.add(fn);
      return () => {
        listeners.get(ev)?.delete(fn);
      };
    },
  } as Gateway;
}
