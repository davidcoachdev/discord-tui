// GIF del README y de la landing: la demo (datos falsos, sin red) animada cuadro a cuadro y armada con ffmpeg.
// Uso: bun scripts/readme-gif.tsx → docs/img/zcord.gif
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JSX } from "solid-js";
import { testRender } from "@opentui/solid";
import sharp from "sharp";

import { App } from "../src/ui/App";
import { Splash } from "../src/ui/components/Splash";
import { THEMES } from "../src/ui/theme";
import { buildDemoStore, demoActions, DEMO } from "./demo-state";
import { toSvg, type Harness } from "./term-svg";

const OUT = "docs/img/zcord.gif";
const SIZE = { width: 150, height: 40 };
const WIDTH_PX = 1100;
const dir = mkdtempSync(join(tmpdir(), "zcord-gif-"));
const frames: { file: string; ms: number }[] = [];

async function snap(h: Harness, ms: number): Promise<void> {
  await h.renderOnce();
  const file = join(dir, `${String(frames.length).padStart(4, "0")}.png`);
  await sharp(Buffer.from(toSvg(h, THEMES.dark.bg))).resize({ width: WIDTH_PX }).png().toFile(file);
  frames.push({ file, ms });
}

async function scene(node: () => JSX.Element, steps: (h: Harness) => Promise<void>): Promise<void> {
  const h = await testRender(node, { ...SIZE, kittyKeyboard: true });
  await h.renderOnce();
  await steps(h);
  h.renderer.destroy();
}

async function typeSlowly(h: Harness, text: string, every = 2): Promise<void> {
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    await h.mockInput.typeText(chars[i]!);
    if (i % every === every - 1 || i === chars.length - 1) await snap(h, 70);
  }
}

// 1. Splash
await scene(() => <Splash theme={THEMES.dark} status="conectando con Discord…" />, async (h) => {
  for (let i = 0; i < 10; i++) {
    await Bun.sleep(90);
    await snap(h, 110);
  }
});

// 2. Chat: escribir con una mención y mandar; después saltar con Ctrl-k y entrar a voz
{
  const store = buildDemoStore();
  const actions = demoActions(store);
  await scene(() => <App store={store} actions={actions} onQuit={() => {}} />, async (h) => {
    await snap(h, 1600);
    h.mockInput.pressKey("i");
    await snap(h, 300);
    await typeSlowly(h, "¿arrancamos la raid a las 22? ");
    await typeSlowly(h, "@ram", 1);
    await snap(h, 1100);
    h.mockInput.pressTab();
    await snap(h, 500);
    h.mockInput.pressEnter();
    await Bun.sleep(30);
    await snap(h, 1500);

    h.mockInput.pressEscape();
    await Bun.sleep(80);
    h.mockInput.pressKey("k", { ctrl: true });
    await snap(h, 500);
    await typeSlowly(h, "sala", 1);
    await snap(h, 1000);
    h.mockInput.pressEnter();
    await Bun.sleep(30);
    await snap(h, 700);

    await actions.voice!.toggleVoice(DEMO.voice);
    await Bun.sleep(700);
    const ramiro = "900000000000000101";
    for (let i = 0; i < 6; i++) {
      store.dispatch({ type: "voice/speaking", userId: ramiro, on: i % 2 === 0 });
      store.dispatch({ type: "voice/selfSpeaking", on: i % 3 === 1 });
      await snap(h, 450);
    }
    await snap(h, 1800);
    await actions.voice!.leaveVoice();
  });
}

// ffmpeg: duraciones por cuadro (concat) + paleta propia para que los colores no se ensucien.
const list = frames.map((f) => `file '${f.file}'\nduration ${(f.ms / 1000).toFixed(3)}`).join("\n") + `\nfile '${frames.at(-1)!.file}'\n`;
await Bun.write(join(dir, "list.txt"), list);
const ff = Bun.spawnSync([
  "ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"),
  "-vf", "split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=none",
  "-loop", "0", OUT,
], { stderr: "inherit" });
rmSync(dir, { recursive: true, force: true });
if (ff.exitCode !== 0) process.exit(ff.exitCode ?? 1);
console.log(`${OUT} · ${frames.length} cuadros · ${(Bun.file(OUT).size / 1024).toFixed(0)} KB`);
process.exit(0);
