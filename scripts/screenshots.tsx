// Capturas del README a partir de la demo (datos falsos, sin red ni terminal): renderiza la UI con sus colores
// a SVG, celda por celda, y la pasa a PNG con sharp. Uso: bun scripts/screenshots.tsx → docs/img/*.png
import { mkdirSync } from "node:fs";
import type { JSX } from "solid-js";
import { testRender } from "@opentui/solid";
import sharp from "sharp";

import { App } from "../src/ui/App";
import { Splash } from "../src/ui/components/Splash";
import { THEMES } from "../src/ui/theme";
import { buildDemoStore, demoActions, DEMO } from "./demo-state";
import { toSvg, type Harness } from "./term-svg";

const OUT = "docs/img";

async function shot(name: string, node: () => JSX.Element, steps: (h: Harness) => Promise<void> = async () => {}, size = { width: 150, height: 40 }): Promise<void> {
  const h = await testRender(node, { ...size, kittyKeyboard: true });
  await h.renderOnce();
  await steps(h);
  await h.renderOnce();
  const png = await sharp(Buffer.from(toSvg(h, THEMES.dark.bg))).png().toBuffer();
  await Bun.write(`${OUT}/${name}.png`, png);
  h.renderer.destroy();
  console.log(`${OUT}/${name}.png`);
}

mkdirSync(OUT, { recursive: true });

await shot("splash", () => <Splash theme={THEMES.dark} status="conectando con Discord…" />, async (h) => {
  await Bun.sleep(400);
  await h.renderOnce();
}, { width: 100, height: 22 });

{
  const store = buildDemoStore();
  const actions = demoActions(store);
  await shot("chat", () => <App store={store} actions={actions} onQuit={() => {}} />, async (h) => {
    h.mockInput.pressKey("i");
    await h.mockInput.typeText("¿arrancamos la raid a las 22? @ram");
    await h.renderOnce();
  });
}

{
  const store = buildDemoStore();
  const actions = demoActions(store);
  await shot("voz", () => <App store={store} actions={actions} onQuit={() => {}} />, async (h) => {
    await actions.voice!.toggleVoice(DEMO.voice);
    store.dispatch({ type: "voice/speaking", userId: "900000000000000101", on: true });
    await Bun.sleep(700);
    await h.renderOnce();
  }, { width: 180, height: 40 });
}

{
  const store = buildDemoStore();
  const actions = demoActions(store);
  await shot("saltar", () => <App store={store} actions={actions} onQuit={() => {}} />, async (h) => {
    h.mockInput.pressKey("k", { ctrl: true });
    await h.renderOnce();
    await h.mockInput.typeText("sa");
    await h.renderOnce();
  });
}

process.exit(0);
