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

const CELL_W = 10;
const CELL_H = 21;
const FONT = "CaskaydiaMono Nerd Font Mono, Noto Color Emoji, monospace";
const OUT = "docs/img";

type Harness = Awaited<ReturnType<typeof testRender>>;

const hex = (c: { r: number; g: number; b: number }): string =>
  `#${[c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const segmenter = new Intl.Segmenter();

function toSvg(h: Harness, bg: string): string {
  const frame = h.captureSpans();
  const parts: string[] = [];
  frame.lines.forEach((line, row) => {
    let col = 0;
    for (const span of line.spans) {
      const y = row * CELL_H;
      if (span.bg.a > 0 && hex(span.bg) !== bg) {
        parts.push(`<rect x="${col * CELL_W}" y="${y}" width="${span.width * CELL_W}" height="${CELL_H}" fill="${hex(span.bg)}"/>`);
      }
      let x = col;
      const bold = (span.attributes & 1) !== 0 ? ' font-weight="bold"' : "";
      for (const { segment } of segmenter.segment(span.text)) {
        const w = Math.max(1, Bun.stringWidth(segment));
        if (segment === "█") {
          parts.push(`<rect x="${x * CELL_W}" y="${y}" width="${CELL_W}" height="${CELL_H}" fill="${hex(span.fg)}"/>`);
        } else if (segment.trim()) {
          parts.push(
            `<text x="${x * CELL_W}" y="${y + CELL_H - 5}" fill="${hex(span.fg)}"${bold}>${esc(segment)}</text>`,
          );
        }
        x += w;
      }
      col += span.width;
    }
  });
  const width = frame.cols * CELL_W;
  const height = frame.rows * CELL_H;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="${FONT}" font-size="16" xml:space="preserve"><rect width="100%" height="100%" fill="${bg}"/>${parts.join("")}</svg>`;
}

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
    await h.mockInput.typeText("¿arrancamos la raid a las 22? @rag");
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
