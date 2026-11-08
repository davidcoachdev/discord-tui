/**
 * Spike Go Live (2026-11-08): cómo usar `Streamer` de @dank074/discord-video-stream
 * SIN el Client selfbot, sobre nuestro Gateway, y SIN que abra su propia conexión de
 * voz principal (la de @discordjs/voice ya está conectada y Discord permite una sola
 * por cuenta).
 *
 * Lo que `Streamer` le pide al client (leído en src/client/Streamer.ts 7.0.0):
 *   - client.on("raw", ({t, d}))     → reemite dispatches por nombre (STREAM_CREATE…)
 *   - client.ws.broadcast({op, d})  → manda op 4/18/19/22 por el gateway
 *   - client.user.id                → nuestro user id
 *   - client.token / client.guilds  → SOLO setStreamPreview (POST de la miniatura);
 *                                     no lo usamos (preview por REST propio, si acaso)
 *
 * Y para `createStream()` solo lee de `voiceConnection`: guildId, channelId,
 * session_id, type, botId (+ escribe `.streamConnection`). No usa su WebSocket. Por eso
 * se le inyecta un VoiceConnection "dormido": tiene el session_id de NUESTRA sesión de
 * voz (el que llega en nuestro VOICE_STATE_UPDATE) pero nunca recibe setTokens(), así
 * que nunca abre el WS de voz principal. Nunca se llama `joinVoice()` (abriría una
 * segunda conexión de voz y mandaría un op 4 con self_deaf:true).
 */
import { Streamer, VoiceConnection } from "@dank074/discord-video-stream";

/** Lo mínimo de nuestro `Gateway` (src/gateway/connection.ts) que hace falta. */
export interface ShimGateway {
  send(op: number, d: unknown): void;
  on(ev: "dispatch", fn: (t: string, d: any) => void): () => void;
}

/** Ops que dejamos pasar desde la librería al gateway. El op 4 NO: lo manda nuestra voz. */
const ALLOWED_OPS = new Set([18, 19, 22]);

export function createGoLiveStreamer(deps: { gateway: ShimGateway; meId: string }) {
  const rawListeners = new Set<(p: { t: string; d: unknown }) => void>();
  const off = deps.gateway.on("dispatch", (t, d) => {
    if (!t.startsWith("STREAM_")) return; // solo lo que la librería necesita
    for (const fn of rawListeners) fn({ t, d });
  });
  const blocked: Array<{ op: number }> = [];

  const fakeClient = {
    user: { id: deps.meId },
    token: undefined,
    on(ev: string, fn: (p: { t: string; d: unknown }) => void) {
      if (ev === "raw") rawListeners.add(fn);
      return fakeClient;
    },
    ws: {
      broadcast(payload: { op: number; d: unknown }) {
        if (!ALLOWED_OPS.has(payload.op)) {
          blocked.push({ op: payload.op });
          return;
        }
        deps.gateway.send(payload.op, payload.d);
      },
    },
  };

  const streamer = new Streamer(fakeClient as any);

  return {
    streamer,
    /** Ops que la librería intentó mandar y bloqueamos (para tests/diagnóstico). */
    blocked,
    /**
     * Marca que estamos en una llamada (con la sesión de voz NUESTRA). Llamar cuando
     * @discordjs/voice ya está Ready; `sessionId` es el session_id del VOICE_STATE_UPDATE propio.
     */
    attachVoice(guildId: string | null, channelId: string, sessionId: string) {
      const vc = new VoiceConnection(streamer, guildId, deps.meId, channelId, () => {});
      vc.session_id = sessionId; // a propósito sin setSession()/setTokens(): no conecta
      (streamer as any)._voiceConnection = vc;
    },
    detachVoice() {
      streamer.stopStream();
      (streamer as any)._voiceConnection = undefined;
    },
    destroy() {
      off();
      rawListeners.clear();
    },
  };
}
