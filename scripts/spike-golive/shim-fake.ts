/**
 * Spike Go Live (2026-11-08): maneja el `Streamer` real de @dank074/discord-video-stream
 * con el shim (streamer-shim.ts) contra un gateway FALSO y un servidor de stream FALSO
 * (WS TLS local). Verifica:
 *   - op 18 STREAM_CREATE y op 22 STREAM_SET_PAUSED salen por nuestro gateway;
 *   - con STREAM_CREATE + STREAM_SERVER_UPDATE abre UNA sola conexión WS (la del stream)
 *     e identifica con nuestro session_id, server_id = rtc_server_id, video:true;
 *   - no abre conexión de voz principal aunque llegue VOICE_SERVER_UPDATE;
 *   - select protocol "webrtc" con SDP de libdatachannel; con DAVE v1 manda el key package
 *     (op binario 26) usando channel_id = rtc_server_id - 1;
 *   - op 12 VIDEO; op 19 STREAM_DELETE al cortar.
 * Sin Discord ni cuenta: todo en 127.0.0.1.
 *   bun scripts/spike-golive/shim-fake.ts
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PeerConnection } from "@lng2004/node-datachannel";

import { createGoLiveStreamer, type ShimGateway } from "./streamer-shim";

const GUILD = "111111111111111111";
const CHANNEL = "222222222222222222";
const ME = "333333333333333333";
const RTC_SERVER_ID = "444444444444444445";
const OUR_SESSION = "our-voice-session-id";

// --- gateway falso ---------------------------------------------------------
const sent: Array<{ op: number; d: any }> = [];
const dispatchFns = new Set<(t: string, d: any) => void>();
const gateway: ShimGateway = {
  send: (op, d) => void sent.push({ op, d }),
  on: (_ev, fn) => {
    dispatchFns.add(fn);
    return () => dispatchFns.delete(fn);
  },
};
const dispatch = (t: string, d: unknown) => dispatchFns.forEach((fn) => fn(t, d));

// --- servidor de stream falso (WS TLS) -------------------------------------
const dir = mkdtempSync(join(tmpdir(), "golive-tls-"));
Bun.spawnSync(
  ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"],
  { stdout: "ignore", stderr: "ignore" },
);
let connections = 0;
const voiceOps: Array<{ op: number; d?: any; binary?: number }> = [];
let serverPeer: PeerConnection | null = null;
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  tls: { cert: readFileSync(join(dir, "c.pem"), "utf8"), key: readFileSync(join(dir, "k.pem"), "utf8") },
  fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("no", { status: 400 })),
  websocket: {
    open() {
      connections++;
    },
    message(ws, raw) {
      if (typeof raw !== "string") {
        const b = Buffer.from(raw as Uint8Array);
        voiceOps.push({ op: -1, binary: b[0] });
        return;
      }
      const { op, d } = JSON.parse(raw);
      voiceOps.push({ op, d });
      if (op === 0) {
        ws.send(JSON.stringify({ op: 8, d: { heartbeat_interval: 13_750 } }));
        ws.send(
          JSON.stringify({
            op: 2,
            d: {
              ssrc: 1000,
              ip: "127.0.0.1",
              port: 50000,
              modes: ["aead_aes256_gcm_rtpsize"],
              streams: [{ type: "video", rid: "100", ssrc: 1001, rtx_ssrc: 1002, active: false, quality: 100 }],
            },
          }),
        );
      } else if (op === 1) {
        // Respuesta con una SDP real de libdatachannel (el cliente solo saca de acá
        // c=, a=rtcp, ice-ufrag/pwd, fingerprint y candidate, y arma la suya).
        serverPeer = new PeerConnection("srv", { iceServers: [], bindAddress: "127.0.0.1" });
        serverPeer.onLocalDescription((sdp, type) => {
          if (type !== "answer") return;
          const withRtcp = `${sdp}\na=rtcp:50000\n`;
          ws.send(JSON.stringify({ op: 4, d: { sdp: withRtcp, dave_protocol_version: 1, audio_codec: "opus", video_codec: "H264" } }));
        });
        serverPeer.setRemoteDescription(d.sdp, "offer");
      }
    },
  },
});

// --- la prueba ---------------------------------------------------------------
const checks: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean) => checks.push([name, ok]);

const golive = createGoLiveStreamer({ gateway, meId: ME });
golive.attachVoice(GUILD, CHANNEL, OUR_SESSION);

const ready = golive.streamer.createStream();
check("op 18 STREAM_CREATE por nuestro gateway", sent.some((s) => s.op === 18 && s.d.guild_id === GUILD && s.d.channel_id === CHANNEL && s.d.type === "guild"));
check("op 22 STREAM_SET_PAUSED(false)", sent.some((s) => s.op === 22 && s.d.paused === false && s.d.stream_key === `guild:${GUILD}:${CHANNEL}:${ME}`));
check("no mandó op 4 propio", !sent.some((s) => s.op === 4) && golive.blocked.length === 0);

const streamKey = `guild:${GUILD}:${CHANNEL}:${ME}`;
// Lo que manda Discord: nuestra voz también recibe VOICE_SERVER_UPDATE; no debe abrir nada.
dispatch("VOICE_SERVER_UPDATE", { guild_id: GUILD, endpoint: `127.0.0.1:${server.port}`, token: "x" });
dispatch("STREAM_CREATE", { stream_key: streamKey, rtc_server_id: RTC_SERVER_ID, viewer_ids: [], paused: false });
dispatch("STREAM_SERVER_UPDATE", { stream_key: streamKey, endpoint: `127.0.0.1:${server.port}`, token: "stream-token-falso" });

const conn = await Promise.race([ready, Bun.sleep(5000).then(() => null)]);
check("createStream() resolvió (select_protocol_ack)", conn !== null);
await Bun.sleep(300);

const identify = voiceOps.find((o) => o.op === 0)?.d;
check("una sola conexión WS (la del stream)", connections === 1);
check("identify.server_id = rtc_server_id", identify?.server_id === RTC_SERVER_ID);
check("identify.session_id = el de NUESTRA voz", identify?.session_id === OUR_SESSION);
check("identify.video = true y streams screen", identify?.video === true && identify?.streams?.[0]?.type === "screen");
check("identify.max_dave_protocol_version >= 1", (identify?.max_dave_protocol_version ?? 0) >= 1);
const select = voiceOps.find((o) => o.op === 1)?.d;
check("select protocol webrtc con SDP de libdatachannel", select?.protocol === "webrtc" && /a=fingerprint/.test(select?.sdp ?? ""));
check("DAVE: mandó key package (op binario 26)", voiceOps.some((o) => o.binary === 26));
check("op 12 VIDEO (atributos apagados al conectar)", voiceOps.some((o) => o.op === 12));
check("DAVE channel id = rtc_server_id - 1", conn?.mediaConnection.daveChannelId === (BigInt(RTC_SERVER_ID) - 1n).toString());

golive.streamer.stopStream();
check("op 19 STREAM_DELETE al cortar", sent.some((s) => s.op === 19 && s.d.stream_key === streamKey));

let fails = 0;
for (const [name, ok] of checks) {
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}`);
}
console.log(`ops de voz recibidos por el server falso: ${voiceOps.map((o) => (o.binary ? `bin${o.binary}` : o.op)).join(",")}`);
console.log(fails ? `SHIM: ${fails} FALLAS` : "SHIM: OK");
server.stop(true);
process.exit(fails ? 1 : 0);
