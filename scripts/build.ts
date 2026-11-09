// Compila zcord de antemano: el JSX de Solid se transforma acá y no en cada arranque. Sin esto, el preload de
// @opentui/solid carga Babel en memoria y transpila cada .tsx al iniciar. Las dependencias quedan externas
// (varias son nativas). Salida: dist/main.js y dist/demo.js (bin/zcord los usa si existen).
import solidPlugin from "@opentui/solid/bun-plugin";

import pkg from "../package.json";

// Solid y los paquetes de OpenTUI que lo usan van adentro del bundle: el plugin cambia solid-js/dist/server.js
// (lo que Bun resuelve en ejecución, sin reactividad) por la versión de cliente. Si quedaran externos, la app se
// dibujaría en blanco. Todo lo demás (incluidas las dependencias nativas) se resuelve desde node_modules.
const BUNDLED = new Set(["solid-js", "@opentui/solid", "@opentui/qrcode", "@opentui/keymap"]);
const external = Object.keys(pkg.dependencies).filter((name) => !BUNDLED.has(name)).flatMap((name) => [name, `${name}/*`]);

const result = await Bun.build({
  entrypoints: ["src/main.tsx", "scripts/demo.tsx"],
  outdir: "dist",
  target: "bun",
  external,
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
