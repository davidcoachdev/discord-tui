/**
 * Spike Go Live (2026-11-08): ¿cargan bajo Bun las dependencias nativas de
 * @dank074/discord-video-stream? No toca la cuenta ni la red.
 * Cada módulo se importa en un proceso aparte porque algunos tiran abajo Bun
 * entero (panic, no excepción).
 *   bun scripts/spike-golive/load-deps.ts            # bajo Bun
 *   bun scripts/spike-golive/load-deps.ts --node     # mismo chequeo bajo Node (si está)
 */
const mods = [
  "@snazzah/davey",
  "@lng2004/node-datachannel",
  "zeromq",
  "sharp",
  "node-av",
  "@dank074/discord-video-stream",
];

const child = process.argv[2] === "--child";
if (child) {
  const m = process.argv[3]!;
  const mod: any = await import(m);
  console.log(Object.keys(mod).slice(0, 6).join(","));
  process.exit(0);
}

const runtime = process.argv.includes("--node") ? ["node", "--experimental-strip-types"] : [process.execPath];
for (const m of mods) {
  const p = Bun.spawnSync([...runtime, import.meta.path, "--child", m], { stdout: "pipe", stderr: "pipe" });
  const out = p.stdout.toString().trim();
  const err = p.stderr.toString();
  if (p.exitCode === 0) console.log(`OK   ${m}  exports: ${out}`);
  else {
    const line =
      err.split("\n").find((l) => /panic|error|Error|Cannot|not found/i.test(l)) ?? err.split("\n")[0];
    console.log(`FAIL ${m} (exit ${p.exitCode ?? p.signalCode}): ${line?.trim()}`);
  }
}
