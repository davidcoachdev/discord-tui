/**
 * Spike "ver transmisiones" (2026-11-08): ¿libdatachannel le entrega al que MIRA el RTP de video de un SSRC que
 * no está en la SDP? El "visor" arma la PeerConnection como @dank074/discord-video-stream (audio mid 0 + video
 * mid 1, SendRecv) y una SDP remota hecha a mano como su handleProtocolAck (solo ICE/DTLS del server). El
 * "server" es otra PeerConnection local que manda H264 con un SSRC arbitrario. Sin Discord.
 *   bun scripts/spike-watch/rtp-routing.ts [inactive|sendonly|ssrc|video-only]
 */
import { Audio, H264RtpPacketizer, PeerConnection, RtpPacketizationConfig, Video } from "@lng2004/node-datachannel";

const mode = process.argv[2] ?? "inactive";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SSRC = 4242;

const viewer = new PeerConnection("viewer", { iceServers: [], bindAddress: "127.0.0.1" });
const keep: unknown[] = [];
const counts = { audio: 0, video: 0 };
if (mode !== "video-only") {
  const a = new Audio("0", "SendRecv");
  a.addOpusCodec(120);
  const at = viewer.addTrack(a);
  at.onMessage(() => counts.audio++);
  keep.push(at);
}
const v = new Video(mode === "video-only" ? "0" : "1", "SendRecv");
v.addH264Codec(101);
const vt = viewer.addTrack(v);
vt.onMessage(() => counts.video++);
keep.push(vt);

const server = new PeerConnection("server", { iceServers: [], bindAddress: "127.0.0.1" });
const serverTracks: any[] = [];
server.onTrack((t) => serverTracks.push(t));

function gathered(pc: PeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.gatheringState() === "complete") return resolve();
    pc.onGatheringStateChange((s) => s === "complete" && resolve());
  });
}
viewer.setLocalDescription();
await gathered(viewer);
server.setRemoteDescription(viewer.localDescription()!.sdp, "offer");
await gathered(server);
const srvSdp = server.localDescription()!.sdp;

let setup = "a=setup:passive";
let ip = "", port = "", ufrag = "", pwd = "", fp = "", cand = "";
for (const line of srvSdp.split(/\r?\n/)) {
  if (line.startsWith("c=")) ip = line;
  else if (line.startsWith("a=ice-ufrag")) ufrag = line;
  else if (line.startsWith("a=ice-pwd")) pwd = line;
  else if (line.startsWith("a=fingerprint")) fp = line;
  else if (line.startsWith("a=candidate") && !cand) cand = line;
  else if (line.startsWith("a=setup")) setup = line;
}
port = cand.split(" ")[5] ?? "9";
const dir = mode === "inactive" ? "a=inactive" : "a=sendonly";
const ssrcLines = mode === "ssrc" ? `a=ssrc:${SSRC} cname:stream` : "";
const audio = `m=audio ${port} UDP/TLS/RTP/SAVPF 120\n${ip}\n${setup}\na=mid:0\n${dir}\n${ufrag}\n${pwd}\n${fp}\n${cand}\na=rtcp-mux\na=rtpmap:120 opus/48000/2\na=ice-lite`;
const video = `m=video ${port} UDP/TLS/RTP/SAVPF 101\n${ip}\n${setup}\na=mid:${mode === "video-only" ? 0 : 1}\n${dir}\n${ufrag}\n${pwd}\n${fp}\n${cand}\na=rtcp-mux\na=ice-lite\na=rtpmap:101 H264/90000\n${ssrcLines}`;
const remote = mode === "video-only" ? video : `${audio}\n${video}`;
const connected = new Promise<void>((res) => viewer.onStateChange((s) => s === "connected" && res()));
viewer.setRemoteDescription(remote, "answer");
await Promise.race([connected, sleep(5000)]);
console.log(`modo ${mode}: visor ${viewer.state()}, tracks del server ${serverTracks.length}`);
if (mode === "late-ssrc") {
  // Renegociación solo local: oferta nueva y la misma respuesta con a=ssrc (el server de Discord no se entera).
  viewer.setLocalDescription();
  viewer.setRemoteDescription(remote.replace("a=rtpmap:101 H264/90000", `a=rtpmap:101 H264/90000\na=ssrc:${SSRC} cname:stream`).replace(/a=inactive/g, "a=sendonly"), "answer");
  await sleep(50);
  console.log(`renegociado: visor ${viewer.state()} ${viewer.signalingState()}`);
}

const st = serverTracks.find((t) => t.mid() === (mode === "video-only" ? "0" : "1")) ?? serverTracks.at(-1);
const cfg = new RtpPacketizationConfig(SSRC, "stream", 101, 90_000);
st?.setMediaHandler(new H264RtpPacketizer("StartSequence", cfg));
for (let i = 0; i < 50 && !st?.isOpen(); i++) await sleep(20);
const frame = Buffer.concat([Buffer.from([0, 0, 0, 1, 0x65]), Buffer.alloc(3000, 1)]);
for (let i = 0; i < 30; i++) {
  st?.sendMessageBinary(frame);
  cfg.timestamp += 3000;
  await sleep(10);
}
await sleep(300);
console.log(`recibido: video ${counts.video} paquetes, audio ${counts.audio}`);
viewer.close();
server.close();
process.exit(0);
