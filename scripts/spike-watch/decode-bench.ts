/**
 * Spike "ver transmisiones" (2026-11-08): costo de decodificar H264 con node-av y achicar a RGBA.
 * ffmpeg (lavfi testsrc2, libx264 como un Go Live: -bf 0, keyframe cada 2 s) → Annex-B en memoria → access units
 * (cortadas por AUD) → createH264Decoder. Mide ms por cuadro y CPU del proceso. Sin Discord.
 *   bun scripts/spike-watch/decode-bench.ts [1280x720] [segundos=10] [mostrar cada N=2] [caja=640x360]
 */
import { spawnClean } from "../../src/proc/spawn";
import { createH264Decoder } from "../../src/watch/decode";
import { splitAnnexB } from "../../src/watch/h264";

const size = process.argv[2] ?? "1280x720";
const secs = Number(process.argv[3] ?? 10);
const every = Number(process.argv[4] ?? 2);
const [bw, bh] = (process.argv[5] ?? "640x360").split("x").map(Number);

const ff = spawnClean(
  ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=30`, "-t", String(secs),
    "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-bf", "0", "-g", "60", "-b:v", "3000k",
    "-x264-params", "aud=1", "-f", "h264", "pipe:1"],
  { stdout: "pipe" },
);
const es = new Uint8Array(await new Response(ff.stdout as ReadableStream).arrayBuffer());
// Access units: cada AUD (tipo 9) empieza una.
const nals = splitAnnexB(es);
const aus: Uint8Array[] = [];
let cur: Uint8Array[] = [];
const sc = new Uint8Array([0, 0, 0, 1]);
for (const nal of nals) {
  if ((nal[0]! & 0x1f) === 9 && cur.length) {
    aus.push(Buffer.concat(cur.flatMap((n) => [sc, n])));
    cur = [];
  }
  cur.push(nal);
}
if (cur.length) aus.push(Buffer.concat(cur.flatMap((n) => [sc, n])));
console.log(`${size}: ${aus.length} access units, ${(es.length / 1024).toFixed(0)} KiB`);

const dec = await createH264Decoder(bw!, bh!);
const cpu0 = process.cpuUsage();
const t0 = performance.now();
let shown = 0;
let w = 0;
let h = 0;
for (let i = 0; i < aus.length; i++) {
  const f = await dec.decode(aus[i]!, i % every === 0);
  if (f) {
    shown++;
    w = f.width;
    h = f.height;
  }
}
const wall = performance.now() - t0;
const cpu = process.cpuUsage(cpu0);
dec.close();
const cpuMs = (cpu.user + cpu.system) / 1000;
const videoMs = (aus.length / 30) * 1000;
console.log(
  `decodificados ${aus.length}, mostrados ${shown} (${w}x${h}); pared ${wall.toFixed(0)} ms (${(wall / aus.length).toFixed(2)} ms/cuadro), ` +
    `CPU ${cpuMs.toFixed(0)} ms → ${((cpuMs / videoMs) * 100).toFixed(1)}% de un núcleo en tiempo real a 30 fps`,
);
