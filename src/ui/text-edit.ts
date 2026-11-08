// Edición de texto del composer: funciones puras sobre (texto, cursor). El cursor es un
// offset UTF-16 que siempre cae en un borde de grafema (un emoji o una letra con tilde es un paso).

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export interface Edited {
  text: string;
  cursor: number;
}

/** Bordes de grafema de `text`, de 0 a text.length inclusive. */
export function graphemeBounds(text: string): number[] {
  const bounds: number[] = [];
  for (const { index } of segmenter.segment(text)) bounds.push(index);
  bounds.push(text.length);
  return bounds;
}

export function clampCursor(text: string, cursor: number): number {
  if (cursor <= 0) return 0;
  if (cursor >= text.length) return text.length;
  const bounds = graphemeBounds(text);
  let best = 0;
  for (const b of bounds) if (b <= cursor) best = b;
  return best;
}

export function prevGrapheme(text: string, cursor: number): number {
  let best = 0;
  for (const b of graphemeBounds(text)) {
    if (b >= cursor) break;
    best = b;
  }
  return best;
}

export function nextGrapheme(text: string, cursor: number): number {
  for (const b of graphemeBounds(text)) if (b > cursor) return b;
  return text.length;
}

const WORD = /[\p{L}\p{N}\p{M}_]/u;

/** Grafemas como [inicio, fin] para recorrer palabras sin partir emojis. */
function segments(text: string): { start: number; end: number; word: boolean }[] {
  const out: { start: number; end: number; word: boolean }[] = [];
  for (const { index, segment } of segmenter.segment(text)) {
    out.push({ start: index, end: index + segment.length, word: WORD.test(segment) });
  }
  return out;
}

/** Ctrl-← / Alt-b: salta los separadores y después la palabra anterior. */
export function wordLeft(text: string, cursor: number): number {
  const segs = segments(text).filter((s) => s.end <= cursor);
  let i = segs.length - 1;
  while (i >= 0 && !segs[i]!.word) i -= 1;
  while (i >= 0 && segs[i]!.word) i -= 1;
  return i < 0 ? 0 : segs[i]!.end;
}

/** Ctrl-→ / Alt-f: salta los separadores y después la palabra siguiente (queda al final de la palabra). */
export function wordRight(text: string, cursor: number): number {
  const segs = segments(text).filter((s) => s.start >= cursor);
  let i = 0;
  while (i < segs.length && !segs[i]!.word) i += 1;
  while (i < segs.length && segs[i]!.word) i += 1;
  return i >= segs.length ? text.length : segs[i]!.start;
}

/** Ctrl-w: como en la shell, borra los espacios y la tira sin espacios anterior al cursor. */
export function ruboutStart(text: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && /\s/.test(text[i - 1]!)) i -= 1;
  while (i > 0 && !/\s/.test(text[i - 1]!)) i -= 1;
  return clampCursor(text, i);
}

export function lineStart(text: string, cursor: number): number {
  return text.lastIndexOf("\n", cursor - 1) + 1;
}

export function lineEnd(text: string, cursor: number): number {
  const at = text.indexOf("\n", cursor);
  return at === -1 ? text.length : at;
}

/** Columna en grafemas desde el inicio de la línea. */
function column(text: string, cursor: number): number {
  return graphemeBounds(text.slice(lineStart(text, cursor), cursor)).length - 1;
}

/** Offset de la columna `col` (en grafemas) dentro de la línea que empieza en `start`, sin pasarse del fin. */
function atColumn(text: string, start: number, col: number): number {
  const end = lineEnd(text, start);
  const bounds = graphemeBounds(text.slice(start, end));
  return start + bounds[Math.min(col, bounds.length - 1)]!;
}

/** ↑: misma columna en la línea anterior; en la primera línea va al principio. */
export function lineUp(text: string, cursor: number): number {
  const start = lineStart(text, cursor);
  if (start === 0) return 0;
  return atColumn(text, lineStart(text, start - 1), column(text, cursor));
}

/** ↓: misma columna en la línea siguiente; en la última línea va al final. */
export function lineDown(text: string, cursor: number): number {
  const end = lineEnd(text, cursor);
  if (end === text.length) return text.length;
  return atColumn(text, end + 1, column(text, cursor));
}

/** Reemplaza [from, to) por `chunk`; el cursor queda después de lo insertado. */
export function splice(text: string, from: number, to: number, chunk: string): Edited {
  return { text: text.slice(0, from) + chunk + text.slice(to), cursor: from + chunk.length };
}
