/**
 * Spike "ver transmisiones" (2026-11-08): costo de cambiar el cuadro de un `<image>` de OpenTUI con RGBA de video
 * (NativeImagePool.publishRgba + source + render). Renderer de test (sin terminal: no mide la subida por el
 * protocolo de kitty, eso es un 🧍 Paso de Gon).
 *   bun scripts/spike-watch/render-bench.tsx [640x360] [cuadros=120]
 */
import { ImageRenderable, NativeImagePool } from "@opentui/core";
import { testRender, useRenderer } from "@opentui/solid";

const [w, h] = (process.argv[2] ?? "640x360").split("x").map(Number) as [number, number];
const n = Number(process.argv[3] ?? 120);
let el: ImageRenderable | undefined;
let pool: NativeImagePool | undefined;
function Probe() {
  const renderer = useRenderer();
  pool = new NativeImagePool({ width: w, height: h, capacity: 3, owner: renderer.nativeScene.resourceContext });
  return <image ref={(node: ImageRenderable) => (el = node)} width={64} height={18} fit="fit" protocol="auto" />;
}
const r = await testRender(() => <Probe />, { width: 80, height: 24 });
await r.renderOnce();
const frames = [0, 1, 2].map((k) => new Uint8Array(w * h * 4).fill(40 + k * 80));
let publish = 0;
let render = 0;
let skipped = 0;
for (let i = 0; i < n; i++) {
  const t0 = performance.now();
  const img = pool!.publishRgba(frames[i % 3]!);
  if (img) {
    el!.source = img;
    img.dispose();
  } else skipped++;
  const t1 = performance.now();
  await r.renderOnce();
  const t2 = performance.now();
  publish += t1 - t0;
  render += t2 - t1;
}
console.log(`${w}x${h}: publishRgba+source ${(publish / n).toFixed(3)} ms/cuadro, renderOnce ${(render / n).toFixed(3)} ms/cuadro, salteados ${skipped}`);
pool!.dispose();
r.renderer.destroy();
process.exit(0);
