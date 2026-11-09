// Render de un frame de testRender a SVG, celda por celda, con los colores de la UI (para capturas y el GIF).
import type { testRender } from "@opentui/solid";

const CELL_W = 10;
const CELL_H = 21;
const FONT = "CaskaydiaMono Nerd Font Mono, Noto Color Emoji, monospace";

export type Harness = Awaited<ReturnType<typeof testRender>>;

const hex = (c: { r: number; g: number; b: number }): string =>
  `#${[c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const segmenter = new Intl.Segmenter();

export function toSvg(h: Harness, bg: string): string {
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

