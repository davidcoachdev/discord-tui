import type { ApiAttachment } from "../store/types";
import type { ImageMode } from "./mode";

/**
 * Animados como GIF: el decoder de OpenTUI 0.8.2 rechaza el WebP animado ("unsupported image
 * feature") y del GIF muestra el primer cuadro.
 */
export function emojiUrl(id: string, animated: boolean, size = 48): string {
  return animated
    ? `https://cdn.discordapp.com/emojis/${id}.gif?size=${size}`
    : `https://cdn.discordapp.com/emojis/${id}.webp?size=${size}&quality=lossless`;
}

const ALLOWED_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

export function isAllowedImageHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_COLS = 40;
const MAX_ROWS = 12;

export type AttachmentView =
  | { kind: "image"; url: string; cols: number; rows: number; label: string }
  | { kind: "link"; label: string; url: string };

/** Imágenes hasta 40x12 celdas manteniendo proporción (una celda ≈ 1:2); lo demás, `📎 nombre (tamaño)`. */
export function attachmentView(a: Pick<ApiAttachment, "filename" | "size" | "url" | "proxy_url" | "content_type" | "width" | "height">, mode: ImageMode): AttachmentView {
  const label = `📎 ${a.filename} (${formatSize(a.size ?? 0)})`;
  const isImage = (a.content_type ?? "").startsWith("image/") && typeof a.width === "number" && typeof a.height === "number";
  const url = a.proxy_url || a.url;
  const width = a.width ?? 0;
  const height = a.height ?? 0;
  if (!isImage || mode === "links" || !isAllowedImageHost(url) || width <= 0 || height <= 0) {
    return { kind: "link", label, url: a.url };
  }
  // Una celda mide ~1:2 (ancho:alto): filas = columnas · alto / (2 · ancho).
  const rowsFor = (c: number): number => Math.max(2, Math.round((c * height) / (2 * width)));
  let cols = Math.min(MAX_COLS, Math.max(4, Math.round(width / 8)));
  let rows = rowsFor(cols);
  if (rows > MAX_ROWS) {
    rows = MAX_ROWS;
    cols = Math.max(4, Math.round((MAX_ROWS * 2 * width) / height));
  }
  return { kind: "image", url, cols, rows, label };
}

export type StickerView = { kind: "image"; url: string; cols: number; rows: number; label: string } | { kind: "label"; label: string };

/**
 * PNG/APNG (1, 2) y GIF (4) como imagen desde el proxy de medios (los GIF no están en el CDN,
 * docs.discord.food → Stickers); Lottie (3), formatos desconocidos o sin imágenes: `🏷 nombre`.
 */
export function stickerView(s: { id: string; name: string; formatType: number }, mode: ImageMode): StickerView {
  const label = `🏷 ${s.name}`;
  const ext = s.formatType === 4 ? "gif" : s.formatType === 1 || s.formatType === 2 ? "png" : null;
  if (ext === null || mode === "links" || !/^\d+$/.test(s.id)) return { kind: "label", label };
  return { kind: "image", url: `https://media.discordapp.net/stickers/${s.id}.${ext}?size=160`, cols: 16, rows: 8, label };
}

/** Pide la versión reducida al proxy de medios de Discord para no bajar originales enormes. */
export function sizedUrl(url: string, cols: number, rows: number): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "media.discordapp.net") return url;
    parsed.searchParams.set("width", String(cols * 10));
    parsed.searchParams.set("height", String(rows * 20));
    return parsed.toString();
  } catch {
    return url;
  }
}
