import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";

import type { PendingAttachment } from "../store/types";

const MAX_BYTES = 10 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  pdf: "application/pdf",
  txt: "text/plain",
  json: "application/json",
  zip: "application/zip",
};

function normalizePath(raw: string): string {
  let p = raw.trim();
  if (p.length >= 2 && (p[0] === '"' || p[0] === "'") && p[p.length - 1] === p[0]) p = p.slice(1, -1).trim();
  if (p === "~" || p.startsWith("~/")) p = (process.env.HOME ?? "") + p.slice(1);
  return p;
}

export async function readAttachmentFromPath(p: string): Promise<PendingAttachment> {
  const path = normalizePath(p);
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new Error("no existe");
  }
  if (info.isDirectory()) throw new Error("es una carpeta");
  if (info.size > MAX_BYTES) throw new Error("pesa más de 10 MiB");
  const bytes = new Uint8Array(await readFile(path));
  const ext = extname(path).slice(1).toLowerCase();
  return { filename: basename(path), mime: MIME_BY_EXT[ext] ?? "application/octet-stream", bytes };
}

function trimNumber(n: number): string {
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${trimNumber(n / 1024)} KB`;
  return `${trimNumber(n / (1024 * 1024))} MB`;
}
