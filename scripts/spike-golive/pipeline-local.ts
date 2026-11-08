/**
 * Spike Go Live (2026-11-08): pipeline de medios de @dank074/discord-video-stream
 * bajo Bun, sin Discord y sin capturar pantalla.
 *   1. prepareStream() con una fuente sintética de ffmpeg (lavfi testsrc2, H264
 *      libx264 o h264_nvenc, contenedor NUT por pipe) → demux() de node-av.
 *   2. Cada paquete H264 se cifra con DAVE (davey `encrypt(VIDEO, H264, …)`) usando
 *      una sesión local que llega a `ready` con los vectores de davey (como
 *      scripts/spike-dave-local.ts, intento b).
 *   bun scripts/spike-golive/pipeline-local.ts [--nvenc] [--audio]
 */
import { Codec, DAVESession, DAVE_PROTOCOL_VERSION, MediaType, ProposalsOperationType } from "@snazzah/davey";
import { Encoders, demux, prepareStream } from "@dank074/discord-video-stream";

import { APPENDING_PROPOSALS, CHANNEL_ID, EXTERNAL_SENDER, MY_USER_ID } from "../../tests/fixtures/davey/vectors";

const nvenc = process.argv.includes("--nvenc");
const audio = process.argv.includes("--audio");
const abort = new AbortController();

const { output, promise } = prepareStream(
  audio ? "testsrc2=size=1280x720:rate=30[out0];sine=f=440[out1]" : "testsrc2=size=1280x720:rate=30",
  {
    customInputOptions: ["-re", "-f", "lavfi"],
    encoder: nvenc ? Encoders.nvenc({ preset: "p1" }) : Encoders.software({ x264: { preset: "ultrafast", tune: "zerolatency" } }),
    bitrateVideo: 3000,
    bitrateVideoMax: 4500,
    includeAudio: audio,
    logLevel: "error",
  },
  abort.signal,
);
promise.catch(() => {});

const { video, audio: aud } = await demux(output, { format: "nut" });
if (!video) throw new Error("sin video");
console.log(`demux OK: codec id ${video.codec}, ${video.width}x${video.height}, audio: ${aud ? "sí" : "no"}`);

const dave = new DAVESession(DAVE_PROTOCOL_VERSION, MY_USER_ID, CHANNEL_ID);
dave.setExternalSender(EXTERNAL_SENDER);
dave.getSerializedKeyPackage();
const { commit } = dave.processProposals(ProposalsOperationType.APPEND, APPENDING_PROPOSALS);
if (commit) dave.processCommit(commit);
console.log(`DAVE ready: ${dave.ready}`);

let packets = 0;
let keyframes = 0;
let plainBytes = 0;
let encBytes = 0;
let encFail = "";
const t0 = performance.now();
await new Promise<void>((resolve) => {
  video.stream.on("data", (pkt: any) => {
    const data: Buffer | undefined = pkt.data;
    if (!data) return;
    packets++;
    if (pkt.isKeyframe ?? (pkt.flags & 1)) keyframes++;
    plainBytes += data.length;
    try {
      encBytes += dave.encrypt(MediaType.VIDEO, Codec.H264, data).length;
    } catch (e: any) {
      encFail = String(e?.message ?? e);
    }
    pkt.free?.();
    if (performance.now() - t0 > 2000) resolve();
  });
});
abort.abort();
console.log(
  `2 s: ${packets} paquetes H264 (${keyframes} keyframes), ${(plainBytes / 1024).toFixed(0)} KiB → ` +
    `DAVE ${(encBytes / 1024).toFixed(0)} KiB${encFail ? `; error al cifrar: ${encFail}` : ""}`,
);
const ok = packets >= 40 && encBytes > plainBytes && !encFail;
console.log(ok ? "PIPELINE LOCAL: OK" : "PIPELINE LOCAL: FALLA");
process.exit(ok ? 0 : 1);
