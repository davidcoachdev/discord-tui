// Compila zcord de antemano: el JSX de Solid se transforma acá y no en cada arranque. Sin esto, el preload de
// @opentui/solid carga Babel en memoria y transpila cada .tsx al iniciar. Las dependencias quedan externas
// (varias son nativas). Salida: dist/main.js y dist/demo.js (bin/zcord los usa si existen).
import solidPlugin from "@opentui/solid/bun-plugin";

const result = await Bun.build({
  entrypoints: ["src/main.tsx", "scripts/demo.tsx"],
  outdir: "dist",
  target: "bun",
  packages: "external",
  minify: { syntax: true, whitespace: true },
  sourcemap: "linked",
  plugins: [solidPlugin],
});
if (!result.success) {
  for (const message of result.logs) console.error(message);
  process.exit(1);
}
await Bun.write("dist/bunfig.toml", "# vacío a propósito: el código ya viene transformado (sin preload de Babel)\n");
for (const output of result.outputs) console.log(`${output.path.replace(process.cwd() + "/", "")} · ${(output.size / 1024).toFixed(0)} KB`);
