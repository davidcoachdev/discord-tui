/**
 * Spike Go Live (2026-11-08): el camino caliente de @dank074/discord-video-stream
 * es libdatachannel (@lng2004/node-datachannel) → H264RtpPacketizer → SRTP.
 * Acá dos PeerConnection locales (127.0.0.1) se conectan entre sí bajo Bun y una
 * le manda a la otra frames H264 sintéticos (bytes falsos con forma de NALU, no
 * video real). Prueba que los callbacks async (threadsafe functions de N-API) y el
 * packetizer andan en Bun. No toca Discord ni la red externa (sin STUN).
 *   bun scripts/spike-golive/webrtc-loopback.ts [--close] [--no-keep]   (GAP_MS=16 entre frames)
 *   node scripts/spike-golive/webrtc-loopback.ts                        (comparar con Node)
 */
import {
  H264RtpPacketizer,
  PeerConnection,
  RtcpSrReporter,
  RtpPacketizationConfig,
  Video,
  cleanup,
} from "@lng2004/node-datachannel";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PT = 103;
const SSRC = 0x1234;

const sender = new PeerConnection("tx", { iceServers: [], bindAddress: "127.0.0.1", enableIceUdpMux: false });
const receiver = new PeerConnection("rx", { iceServers: [], bindAddress: "127.0.0.1", enableIceUdpMux: false });

const vdef = new Video("video", "SendOnly");
vdef.addH264Codec(PT);
vdef.addSSRC(SSRC, "tui", "stream", "video");
const track = sender.addTrack(vdef);
const cfg = new RtpPacketizationConfig(SSRC, "tui", PT, 90_000);
const packetizer = new H264RtpPacketizer("StartSequence", cfg);
packetizer.addToChain(new RtcpSrReporter(cfg));
track.setMediaHandler(packetizer);

let rtpPackets = 0;
let rtpBytes = 0;
// Ojo Bun: hay que guardar una referencia al Track recibido; si no, el GC de Bun lo
// junta y dejan de llegar los onMessage (en Node no pasa). Con --no-keep se ve.
const keep: unknown[] = [];
receiver.onTrack((t) => {
  if (!process.argv.includes("--no-keep")) keep.push(t);
  t.onMessage((msg) => {
    rtpPackets++;
    rtpBytes += msg.length;
  });
});

// Sin trickle: se espera a juntar todos los candidatos y se pasa la SDP completa
// (evita la carrera "remote candidate without remote description").
function gathered(pc: PeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.gatheringState() === "complete") return resolve();
    pc.onGatheringStateChange((s) => s === "complete" && resolve());
  });
}

const t0 = performance.now();
const connected = new Promise<void>((resolve, reject) => {
  const to = setTimeout(() => reject(new Error(`timeout; estado ${sender.state()}`)), 8000);
  sender.onStateChange((s) => {
    if (s === "connected") {
      clearTimeout(to);
      resolve();
    }
  });
});
sender.setLocalDescription();
await gathered(sender);
const offer = sender.localDescription()!;
receiver.setRemoteDescription(offer.sdp, offer.type);
await gathered(receiver);
const answer = receiver.localDescription()!;
sender.setRemoteDescription(answer.sdp, answer.type);
await connected;
console.log(`conectado en ${(performance.now() - t0).toFixed(0)} ms (DTLS-SRTP local)`);

// Esperar a que el track quede abierto.
for (let i = 0; i < 50 && !track.isOpen(); i++) await sleep(20);
console.log(`track abierto: ${track.isOpen()}`);

// 60 "frames" Annex-B: SPS/PPS/IDR falsos + P frames de ~20 KB (fuerzan FU-A).
const start = Buffer.from([0, 0, 0, 1]);
function fakeFrame(i: number): Buffer {
  const body = Buffer.alloc(i % 30 === 0 ? 60_000 : 20_000, i & 0xff);
  const nalType = i % 30 === 0 ? 0x65 : 0x41;
  const parts = [start, Buffer.from([nalType]), body];
  if (i % 30 === 0) parts.unshift(start, Buffer.from([0x67, 0x42, 0, 0x1f]), start, Buffer.from([0x68, 0xce, 0x3c, 0x80]));
  return Buffer.concat(parts);
}
let sentBytes = 0;
const t1 = performance.now();
for (let i = 0; i < 60; i++) {
  const f = fakeFrame(i);
  sentBytes += f.length;
  track.sendMessageBinary(f);
  cfg.timestamp += 3000; // 30 fps
  await sleep(Number(process.env.GAP_MS ?? 16));
}
await sleep(300);
const ms = performance.now() - t1;
console.log(
  `mandados 60 frames (${(sentBytes / 1024).toFixed(0)} KiB) en ${ms.toFixed(0)} ms; ` +
    `recibidos ${rtpPackets} paquetes RTP (${(rtpBytes / 1024).toFixed(0)} KiB)`,
);
const ok = rtpPackets > 60 && rtpBytes > sentBytes * 0.5;
console.log(ok ? "WEBRTC LOOPBACK: OK" : "WEBRTC LOOPBACK: FALLA");
// --close: cierra todo antes de salir. Con --no-keep (Track juntado por el GC) Bun
// 1.4.3 segfaultea al cerrar; con la referencia guardada cierra limpio.
if (process.argv.includes("--close")) {
  sender.close();
  receiver.close();
  cleanup();
}
process.exit(ok ? 0 : 1);
