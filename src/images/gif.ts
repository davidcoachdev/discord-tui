/**
 * GIF (o WebP) animado → cuadros RGBA + demoras, con sharp (libvips). OpenTUI 0.8.2 solo decodifica el
 * primer cuadro de un GIF, así que la animación la hacemos nosotros cambiando la imagen.
 */

export interface Frame {
  /** RGBA sin premultiplicar, `width * height * 4` bytes. */
  rgba: Uint8Array;
  delayMs: number;
}

export interface Animation {
  width: number;
  height: number;
  frames: Frame[];
  bytes: number;
}

export interface FrameLimits {
  maxFrames: number;
  maxDurationMs: number;
  maxBytes: number;
}

export const FRAME_LIMITS: FrameLimits = { maxFrames: 150, maxDurationMs: 10_000, maxBytes: 24 * 1024 * 1024 };

/** ≤ 25 fps. */
export const MIN_DELAY_MS = 40;

export function isGif(bytes: Uint8Array): boolean {
  return bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
}

/** `RIFF····WEBP`: el decoder de OpenTUI rechaza el WebP animado, sharp no. */
export function isWebp(bytes: Uint8Array): boolean {
  const tag = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4));
  return bytes.length >= 12 && tag(0) === "RIFF" && tag(8) === "WEBP";
}

/** Formatos que pueden traer varios cuadros y vale la pena pasar por sharp. */
export function mayAnimate(bytes: Uint8Array): boolean {
  return isGif(bytes) || isWebp(bytes);
}

/** Como los navegadores: 0–10 ms es "sin demora" y se muestra a 100 ms; después, nunca menos de 40 ms. */
export function normalizeDelay(ms: number | undefined): number {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 10) return 100;
  return Math.max(MIN_DELAY_MS, Math.round(ms));
}

/**
 * Recorta a `maxDurationMs` (la animación vuelve a empezar) y, si siguen siendo demasiados cuadros
 * o bytes, se queda con uno de cada `step` sumando las demoras de los que saltea.
 */
export function limitFrames(frames: Frame[], frameBytes: number, limits: FrameLimits = FRAME_LIMITS): Frame[] {
  const kept: Frame[] = [];
  let elapsed = 0;
  for (const frame of frames) {
    if (kept.length > 0 && elapsed >= limits.maxDurationMs) break;
    kept.push(frame);
    elapsed += frame.delayMs;
  }
  const byBytes = Math.max(1, Math.floor(limits.maxBytes / Math.max(1, frameBytes)));
  const maxCount = Math.max(1, Math.min(limits.maxFrames, byBytes));
  if (kept.length <= maxCount) return kept;
  const step = Math.ceil(kept.length / maxCount);
  const out: Frame[] = [];
  for (let i = 0; i < kept.length; i += step) {
    const group = kept.slice(i, i + step);
    out.push({ rgba: group[0]!.rgba.slice(), delayMs: group.reduce((sum, f) => sum + f.delayMs, 0) });
  }
  return out;
}

type Sharp = (typeof import("sharp"))["default"];
let sharpModule: Promise<Sharp | null> | null = null;

/** sharp es nativo: si no carga, `null` y se queda el primer cuadro de siempre. */
export function loadSharp(): Promise<Sharp | null> {
  sharpModule ??= import("sharp").then((m) => m.default).catch(() => null);
  return sharpModule;
}

/**
 * Decodifica un GIF (o WebP) de 2+ cuadros achicado para caber en `maxWidth × maxHeight` píxeles.
 * Un solo cuadro, otro formato o cualquier error → null.
 */
export async function decodeAnimated(bytes: Uint8Array, maxWidth: number, maxHeight: number, limits: FrameLimits = FRAME_LIMITS): Promise<Animation | null> {
  if (!mayAnimate(bytes)) return null;
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    const meta = await sharp(bytes, { animated: true }).metadata();
    const pages = meta.pages ?? 1;
    if (pages < 2) return null;
    const { data, info } = await sharp(bytes, { animated: true })
      .resize(Math.max(1, Math.round(maxWidth)), Math.max(1, Math.round(maxHeight)), { fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const width = info.width;
    const pageHeight = info.pageHeight ?? Math.floor(info.height / pages);
    const count = Math.floor(info.height / pageHeight);
    if (info.channels !== 4 || count < 2 || width <= 0 || pageHeight <= 0) return null;
    const frameBytes = width * pageHeight * 4;
    const raw = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const frames: Frame[] = [];
    for (let i = 0; i < count; i++) {
      frames.push({ rgba: raw.subarray(i * frameBytes, (i + 1) * frameBytes), delayMs: normalizeDelay(meta.delay?.[i]) });
    }
    let limited = limitFrames(frames, frameBytes, limits);
    // Recortado por duración: copiar para no retener el buffer entero de todos los cuadros.
    if (limited.length < count && limited[0]!.rgba.buffer === raw.buffer) {
      limited = limited.map((f) => ({ rgba: f.rgba.slice(), delayMs: f.delayMs }));
    }
    return { width, height: pageHeight, frames: limited, bytes: limited.length * frameBytes };
  } catch {
    return null;
  }
}
