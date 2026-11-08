/**
 * Spike "ver transmisiones" (2026-11-08), punta a punta sin Discord: NUESTRO emisor de Go Live (shim + playStream de
 * @dank074/discord-video-stream, video sintético de ffmpeg lavfi) → servidor de stream FALSO en modo relay →
 * NUESTRA conexión de espectador (src/watch/viewer.ts) → depacketizer H264 → decodificador node-av a RGBA.
 *   bun scripts/spike-watch/loopback.ts [segundos=6] [dave=0|1]
 */
import { createGoLiveShim, loadGoLiveLib } from "../../src/golive/shim";
import { createH264Decoder } from "../../src/watch/decode";
import { createViewerConnection, loadViewerLib } from "../../src/watch/viewer";
import { fakeGateway, startFakeStreamServer } from "../../tests/fakes/fake-stream-server";

const secs = Number(process.argv[2] ?? 6);
const dave = Number(process.argv[3] ?? 0);
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // solo el certificado propio del server falso en 127.0.0.1

const GUILD = "111111111111111111";
const CHANNEL = "222222222222222222";
const STREAMER = "333333333333333333";
const VIEWER = "555555555555555555";
const KEY = `guild:${GUILD}:${CHANNEL}:${STREAMER}`;
const server = startFakeStreamServer({ relay: true, dave, streamerId: STREAMER });

// Emisor
const lib = await loadGoLiveLib();
const gw = fakeGateway();
const shim = createGoLiveShim({ gateway: gw, meId: STREAMER, lib });
shim.attachVoice(GUILD, CHANNEL, "sender-session");
const mod: any = await import("@dank074/discord-video-stream");
const abort = new AbortController();
const { output, promise } = mod.prepareStream(
  "testsrc2=size=1280x720:rate=30",
  {
    customInputOptions: ["-re", "-f", "lavfi"],
    encoder: mod.Encoders.software({ x264: { preset: "ultrafast", tune: "zerolatency" } }),
    bitrateVideo: 2500,
    bitrateVideoMax: 3500,
    includeAudio: false,
    logLevel: "error",
    customFfmpegFlags: ["-g", "60", "-bf", "0"],
  },
  abort.signal,
);
promise.catch(() => {});
const playing = lib.playStream(output, shim.streamer, { type: "go-live", format: "nut" }, abort.signal).catch((e: unknown) => console.log("playStream:", String(e)));
for (let i = 0; i < 100 && !gw.sent.some((x) => x.op === 18); i++) await Bun.sleep(50); // playStream demuxea antes del op 18
gw.dispatch("STREAM_CREATE", { stream_key: KEY, rtc_server_id: "444444444444444445", viewer_ids: [], paused: false });
gw.dispatch("STREAM_SERVER_UPDATE", { stream_key: KEY, endpoint: server.endpoint, token: "t" });

// Espectador
for (let i = 0; i < 100 && !server.ops.some((o) => o.op === 12 && o.d?.streams?.some((x: any) => x.active)); i++) await Bun.sleep(50);
console.log(`emisor en vivo a ${(performance.now()).toFixed(0)} ms`);
const vlib = await loadViewerLib();
const decoder = await createH264Decoder(640, 360);
let aus = 0;
let decoded = 0;
let firstFrameMs = 0;
let size = "";
let chain: Promise<void> = Promise.resolve();
let decodeMs = 0;
const t0 = performance.now();
const cpu0 = process.cpuUsage();
const viewer = createViewerConnection(
  vlib,
  { guildId: GUILD, channelId: CHANNEL, meId: VIEWER, streamerId: STREAMER, sessionId: "viewer-session", rtcServerId: "444444444444444445", streamKey: KEY, endpoint: server.endpoint, token: "t" },
  {
    onFrame(au) {
      aus++;
      // Se decodifican TODAS (H264 no admite saltear); se escala una de cada 2 (15 fps).
      const want = aus % 2 === 0;
      chain = chain.then(async () => {
        const t = performance.now();
        const f = await decoder.decode(au, want);
        decodeMs += performance.now() - t;
        if (!f) return;
        decoded++;
        size = `${f.width}x${f.height}`;
        if (!firstFrameMs) firstFrameMs = performance.now() - t0;
      });
    },
    onClose: (code) => console.log("viewer WS cerrado", code),
    onUnsupportedCodec: (c) => console.log("códec", c),
  },
);
await Bun.sleep(secs * 1000);
const cpu = process.cpuUsage(cpu0);
console.log(
  `${secs} s: relay ${server.relayed()} paquetes; visor ${JSON.stringify(viewer.stats())}; AUs ${aus}, decodificados ${decoded} (${size}), ` +
    `primer cuadro a ${firstFrameMs.toFixed(0)} ms, decode+escala ${(decodeMs / Math.max(1, aus)).toFixed(2)} ms/AU; CPU del proceso (emisor+server+visor) ${(((cpu.user + cpu.system) / 1000 / (secs * 1000)) * 100).toFixed(0)}%`,
);
console.log("ops del visor:", server.ops.filter((o) => o.op !== 3).map((o) => o.op ?? `bin`).join(","));
const ok = decoded > secs * 12;
console.log(ok ? "LOOPBACK VER: OK" : "LOOPBACK VER: FALLA");
viewer.stop();
abort.abort();
await playing;
shim.destroy();
decoder.close();
server.stop();
process.exit(ok ? 0 : 1);
