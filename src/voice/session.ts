import type { DiscordGatewayAdapterCreator, VoiceConnection } from "@discordjs/voice";

import { log } from "../log/logger";
import { closeCodeMessage, isFatalVoiceClose } from "./close-codes";
import { sanitizeVoiceDebug } from "./debug";

export type VoiceStatus = "idle" | "joining" | "connected" | "reconnecting" | "error";

export interface VoiceFlags {
  selfMute: boolean;
  selfDeaf: boolean;
}

/**
 * Un frame que sigue cifrado con DAVE termina con el marcador mágico 0xFAFA (spec 6.6). `@discordjs/voice`
 * devuelve el paquete tal cual cuando la sesión DAVE todavía no está lista (al entrar o en un cambio de
 * época): decodificar ese ciphertext como Opus suena como ráfagas de ruido, así que se descarta.
 */
export function isStillDaveEncrypted(opus: Uint8Array): boolean {
  const n = opus.byteLength;
  return n >= 2 && opus[n - 1] === 0xfa && opus[n - 2] === 0xfa;
}

export interface VoiceSession {
  join(guildId: string, channelId: string, flags: VoiceFlags): Promise<void>;
  setFlags(flags: VoiceFlags): void;
  leave(): Promise<void>;
  onStatus(fn: (status: VoiceStatus, error?: string) => void): () => void;
  /** Manda un frame Opus de 20 ms (cifrado de transporte y DAVE los pone la conexión). */
  sendOpus(frame: Uint8Array): void;
  setSpeaking(on: boolean): void;
  onSpeaking(fn: (userId: string, on: boolean) => void): () => void;
  onOpus(fn: (userId: string, opus: Uint8Array) => void): () => void;
  privacyCode(): string | null;
  /** El gateway principal volvió a estar listo: si la voz quedó colgada esperando, reintenta. */
  gatewayReady?(): void;
}

/** Lo que usamos de `@discordjs/voice`; inyectable para los tests. */
export interface VoiceLib {
  joinVoiceChannel(config: {
    guildId: string;
    channelId: string;
    adapterCreator: DiscordGatewayAdapterCreator;
    selfMute: boolean;
    selfDeaf: boolean;
    daveEncryption: boolean;
    debug: boolean;
    group: string;
  }): VoiceConnection;
  afterSilence: number;
}

async function loadLib(): Promise<VoiceLib> {
  const mod = await import("@discordjs/voice");
  return {
    joinVoiceChannel: mod.joinVoiceChannel as VoiceLib["joinVoiceChannel"],
    afterSilence: mod.EndBehaviorType.AfterSilence,
  };
}

const JOIN_TIMEOUT_MS = 20_000;
const MAX_REJOINS = 3;

export function createDjsVoiceSession(deps: {
  adapterCreator: (guildId: string) => DiscordGatewayAdapterCreator;
  meId: () => string | null;
  lib?: VoiceLib;
  joinTimeoutMs?: number;
  /** Si el gateway principal puede mandar op 4 ahora (si no, la librería destruye la conexión). */
  canSignal?: () => boolean;
  moveGraceMs?: number;
  retryMs?: number;
}): VoiceSession {
  const canSignal = deps.canSignal ?? ((): boolean => true);
  let generation = 0;
  let wantedFlags: VoiceFlags | null = null;
  let retries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let abortWait: (() => void) | null = null;
  const statusListeners = new Set<(status: VoiceStatus, error?: string) => void>();
  const speakingListeners = new Set<(userId: string, on: boolean) => void>();
  const opusListeners = new Set<(userId: string, opus: Uint8Array) => void>();
  let connection: VoiceConnection | null = null;
  let status: VoiceStatus = "idle";
  let lib: VoiceLib | null = deps.lib ?? null;

  function setStatus(next: VoiceStatus, error?: string): void {
    if (next === status && error === undefined) return;
    status = next;
    log.info("voice.status", { state: next });
    for (const fn of [...statusListeners]) fn(next, error);
  }

  function teardown(conn: VoiceConnection, notifyDiscord: boolean): void {
    conn.removeAllListeners();
    conn.on("error", () => {});
    try {
      if (conn.state.status !== "destroyed") conn.destroy(notifyDiscord);
    } catch {
      // ya estaba destruida
    }
  }

  function fail(conn: VoiceConnection, message: string): void {
    if (connection !== conn) return;
    connection = null;
    teardown(conn, true);
    setStatus("error", message);
  }

  function wireReceive(conn: VoiceConnection, afterSilence: number): void {
    const speaking = conn.receiver.speaking;
    speaking.on("start", (userId: string) => {
      if (connection !== conn || userId === deps.meId()) return;
      for (const fn of [...speakingListeners]) fn(userId, true);
      if (conn.receiver.subscriptions.has(userId)) return;
      const stream = conn.receiver.subscribe(userId, { end: { behavior: afterSilence, duration: 300 } } as never);
      stream.on("data", (chunk: Buffer) => {
        if (connection !== conn) return;
        const opus = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        if (isStillDaveEncrypted(opus)) return;
        for (const fn of [...opusListeners]) fn(userId, opus);
      });
      stream.on("error", (error: unknown) => {
        log.warn("voice.receive-error", { error_name: error instanceof Error ? error.name : "unknown" });
      });
    });
    speaking.on("end", (userId: string) => {
      if (connection !== conn || userId === deps.meId()) return;
      for (const fn of [...speakingListeners]) fn(userId, false);
    });
  }

  function clearRetry(): void {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  }

  /** Reintenta entrar mientras la conexión siga caída; sin gateway listo, espera a que vuelva. */
  function scheduleRetry(conn: VoiceConnection): void {
    clearRetry();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (connection !== conn || conn.state.status !== "disconnected") return;
      if (retries >= MAX_REJOINS) return fail(conn, "se cortó la voz y no pude volver a entrar");
      if (!canSignal()) return scheduleRetry(conn);
      retries += 1;
      conn.rejoin();
      if (conn.state.status === "disconnected") scheduleRetry(conn);
    }, deps.retryMs ?? 1_000);
  }

  function watchNetworking(conn: VoiceConnection): void {
    let watched: unknown = null;
    let moveTimer: ReturnType<typeof setTimeout> | null = null;
    conn.on("stateChange", (oldState: any, newState: any) => {
      if (connection !== conn) return;
      const networking = newState?.networking;
      if (networking && networking !== watched) {
        watched = networking;
        networking.once("close", (code: number) => {
          if (connection !== conn) return;
          log.warn("voice.closed", { close_code: code });
          // 4014 puede ser "te movieron de canal": lo resuelve el estado disconnected con un margen.
          if (code !== 4014 && isFatalVoiceClose(code)) fail(conn, closeCodeMessage(code));
          else if (conn.rejoinAttempts > MAX_REJOINS) fail(conn, closeCodeMessage(code));
          else setStatus("reconnecting");
        });
      }
      if (newState.status !== "disconnected" && moveTimer !== null) {
        clearTimeout(moveTimer);
        moveTimer = null;
      }
      if (newState.status === "ready") {
        retries = 0;
        clearRetry();
        setStatus("connected");
        const flags = wantedFlags;
        if (flags && (flags.selfMute !== conn.joinConfig.selfMute || flags.selfDeaf !== conn.joinConfig.selfDeaf) && canSignal()) {
          conn.rejoin({ ...conn.joinConfig, ...flags });
        }
      } else if (newState.status === "disconnected" && oldState.status !== "disconnected") {
        const code = typeof newState.closeCode === "number" ? newState.closeCode : null;
        if (code === 4014) {
          setStatus("reconnecting");
          moveTimer = setTimeout(() => {
            moveTimer = null;
            if (connection === conn && conn.state.status === "disconnected") fail(conn, closeCodeMessage(4014));
          }, deps.moveGraceMs ?? 5_000);
          return;
        }
        if (code !== null && isFatalVoiceClose(code)) return fail(conn, closeCodeMessage(code));
        setStatus("reconnecting");
        scheduleRetry(conn);
      } else if (oldState.status === "ready" && (newState.status === "signalling" || newState.status === "connecting")) {
        setStatus("reconnecting");
      }
    });
  }

  async function leave(): Promise<void> {
    generation += 1;
    clearRetry();
    abortWait?.();
    wantedFlags = null;
    const conn = connection;
    connection = null;
    if (conn) teardown(conn, true);
    setStatus("idle");
  }

  return {
    async join(guildId, channelId, flags): Promise<void> {
      if (connection) await leave();
      const mine = ++generation;
      setStatus("joining");
      lib ??= await loadLib();
      // Si mientras cargaba la librería se salió (o se pidió otro canal), no se entra.
      if (mine !== generation) return;
      wantedFlags = { ...flags };
      retries = 0;
      const conn = lib.joinVoiceChannel({
        guildId,
        channelId,
        adapterCreator: deps.adapterCreator(guildId),
        selfMute: flags.selfMute,
        selfDeaf: flags.selfDeaf,
        daveEncryption: true,
        debug: true,
        group: "discord-tui",
      });
      connection = conn;

      conn.on("error", (error: unknown) => {
        log.error("voice.error", { error_name: error instanceof Error ? error.name : "unknown" });
      });
      conn.on("debug", (line: string) => {
        const safe = sanitizeVoiceDebug(line);
        if (safe !== null) log.info("voice.debug", { msg: safe });
      });
      watchNetworking(conn);
      wireReceive(conn, lib.afterSilence);

      const timeoutMs = deps.joinTimeoutMs ?? JOIN_TIMEOUT_MS;
      await new Promise<void>((resolve) => {
        if (conn.state.status === "ready") {
          setStatus("connected");
          return resolve();
        }
        const timer = setTimeout(() => {
          off();
          if (connection === conn && conn.state.status !== "ready") {
            fail(conn, "no pude conectar a la voz (tardó demasiado)");
          }
          resolve();
        }, timeoutMs);
        abortWait = (): void => {
          off();
          resolve();
        };
        const off = (): void => {
          abortWait = null;
          clearTimeout(timer);
          conn.off("stateChange", onChange);
        };
        const onChange = (_old: any, next: any): void => {
          if (next.status === "ready" || next.status === "destroyed" || connection !== conn) {
            off();
            resolve();
          }
        };
        conn.on("stateChange", onChange);
      });
    },

    setFlags(flags): void {
      wantedFlags = { ...flags };
      const conn = connection;
      if (!conn) return;
      // rejoin() fuera de "ready" deja la conexión en signalling para siempre, y sin gateway la destruye:
      // en esos casos se guardan los flags y se mandan cuando vuelve a estar lista.
      if (conn.state.status !== "ready" || !canSignal()) return;
      conn.rejoin({ ...conn.joinConfig, selfMute: flags.selfMute, selfDeaf: flags.selfDeaf });
    },

    gatewayReady(): void {
      const conn = connection;
      if (!conn || conn.state.status !== "disconnected") return;
      if (retries >= MAX_REJOINS) return fail(conn, "se cortó la voz y no pude volver a entrar");
      retries += 1;
      conn.rejoin();
    },

    leave,

    onStatus(fn) {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    },

    sendOpus(frame: Uint8Array): void {
      connection?.playOpusPacket(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
    },

    setSpeaking(on: boolean): void {
      connection?.setSpeaking(on);
    },

    onSpeaking(fn) {
      speakingListeners.add(fn);
      return () => speakingListeners.delete(fn);
    },

    onOpus(fn) {
      opusListeners.add(fn);
      return () => opusListeners.delete(fn);
    },

    privacyCode(): string | null {
      try {
        return connection?.voicePrivacyCode ?? null;
      } catch {
        return null;
      }
    },
  };
}
