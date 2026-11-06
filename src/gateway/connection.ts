import type { ClientProps } from "../client-props/props";
import { log } from "../log/logger";
import type { Secret } from "../secret";
import { buildIdentify } from "./identify";
import { createZlibStreamInflater } from "./inflate";

export type GatewayStatus = "connecting" | "identifying" | "ready" | "resuming" | "reconnecting" | "disconnected";

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
  on(ev: "session", fn: (kind: "identified" | "resumed") => void): () => void;
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
  const inflater = createZlibStreamInflater();

  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  let socket: WebSocket | null = null;
  let status: GatewayStatus = "disconnected";
  let sessionId: string | null = null;
  let resumeGatewayUrl: string | null = null;
  let seq: number | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let closedByUser = false;
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

  function startHeartbeat(interval: number): void {
    stopHeartbeat();
    if (!Number.isFinite(interval) || interval <= 0) return;
    const jitter = Math.floor(interval * random());
    heartbeatTimer = setTimeout(() => {
      send(1, seq);
      heartbeatTimer = setInterval(() => send(1, seq), interval);
    }, jitter);
  }

  function onDispatch(t: string, d: any, s: number | null): void {
    if (typeof s === "number") seq = s;
    log.info("gateway.dispatch", { t, seq: s ?? undefined });
    if (t === "READY" && d && typeof d === "object") {
      sessionId = typeof d.session_id === "string" ? d.session_id : sessionId;
      resumeGatewayUrl = typeof d.resume_gateway_url === "string" ? d.resume_gateway_url : resumeGatewayUrl;
      setStatus("ready");
      emit("session", "identified");
    }
    emit("dispatch", t, d);
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
        setStatus("identifying");
        const identify = buildIdentify(deps.token, deps.props);
        send(2, identify.d);
        startHeartbeat(message.d?.heartbeat_interval ?? 0);
        return;
      }
      case 11:
        return;
      case 1:
        send(1, seq);
        return;
      case 0:
        onDispatch(String(message.t), message.d, typeof message.s === "number" ? message.s : null);
        return;
      default:
        return;
    }
  }

  function handleClose(code: number): void {
    stopHeartbeat();
    socket = null;
    setStatus("disconnected");
    if (code === 4004) {
      log.error("gateway.fatal", { close_code: code });
      emit("fatal", "unauthorized");
    }
  }

  return {
    connect(): void {
      if (socket !== null) return;
      closedByUser = false;
      setStatus("connecting");
      const ws = new WebSocketImpl(url);
      socket = ws;

      ws.onmessage = (event: MessageEvent) => {
        let text: string | null;
        if (typeof event.data === "string") {
          text = event.data;
        } else {
          const bytes = toBytes(event.data);
          text = bytes === null ? null : inflater.push(bytes);
        }
        if (text !== null) handleMessage(text);
      };
      ws.onclose = (event: CloseEvent) => {
        if (socket === ws) handleClose(event.code);
      };
      ws.onerror = () => {
        // el cierre llega por onclose
      };
    },
    close(): void {
      closedByUser = true;
      stopHeartbeat();
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
