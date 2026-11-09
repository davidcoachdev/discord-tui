import { log } from "../log/logger";
import { spawnClean } from "../proc/spawn";

type SpawnFn = (cmd: string[]) => { stdout: ReadableStream<Uint8Array> | null; exited: Promise<number> };

export interface ClipboardDeps {
  spawn?: SpawnFn;
  now?: () => Date;
}

const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function defaultSpawn(cmd: string[]): { stdout: ReadableStream<Uint8Array> | null; exited: Promise<number> } {
  const proc = spawnClean(cmd, { stdout: "pipe" });
  return { stdout: proc.stdout as ReadableStream<Uint8Array> | null, exited: proc.exited };
}

async function run(spawn: SpawnFn, cmd: string[]): Promise<Uint8Array | null> {
  try {
    const proc = spawn(cmd);
    if (proc.stdout === null) return null;
    const [bytes, code] = await Promise.all([new Response(proc.stdout).bytes(), proc.exited]);
    if (code !== 0 || bytes.byteLength === 0) {
      log.info("clipboard.wl_paste", { msg: cmd.slice(1).join(" "), code, count: bytes.byteLength });
      return null;
    }
    return bytes;
  } catch (error) {
    log.warn("clipboard.wl_paste", { msg: cmd.slice(1).join(" "), error_name: error instanceof Error ? error.message : "error" });
    return null;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function stamp(d: Date): string {
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${date}-${time}`;
}

export async function readClipboardImage(
  deps: ClipboardDeps = {},
): Promise<{ bytes: Uint8Array; mime: string; filename: string } | null> {
  const spawn = deps.spawn ?? defaultSpawn;
  const list = await run(spawn, ["wl-paste", "--list-types"]);
  if (list === null) return null;
  const types = new Set(
    new TextDecoder()
      .decode(list)
      .split("\n")
      .map((line) => line.trim()),
  );
  const mime = Object.keys(IMAGE_TYPES).find((type) => types.has(type));
  if (mime === undefined) return null;
  const bytes = await run(spawn, ["wl-paste", "--type", mime]);
  if (bytes === null) return null;
  const now = (deps.now ?? ((): Date => new Date()))();
  return { bytes, mime, filename: `captura-${stamp(now)}.${IMAGE_TYPES[mime]}` };
}

export async function readClipboardText(deps: ClipboardDeps = {}): Promise<string | null> {
  const bytes = await run(deps.spawn ?? defaultSpawn, ["wl-paste", "--no-newline", "--type", "text/plain"]);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

const FILE_LIST_TYPES = ["text/uri-list", "x-special/gnome-copied-files"];
export const MAX_CLIPBOARD_FILES = 10;

/** `file:///home/a/b%20c.png` → `/home/a/b c.png`; ignora líneas que no son archivos locales. */
export function filePathsFromUriList(text: string): string[] {
  const paths: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line === "copy" || line === "cut") continue;
    if (line.startsWith("file://")) {
      try {
        paths.push(decodeURIComponent(new URL(line).pathname));
      } catch {
        // URI rota
      }
    }
  }
  return paths.slice(0, MAX_CLIPBOARD_FILES);
}

/**
 * Lo que trae el texto pegado por la terminal (Ctrl+Shift+V): si son solo rutas de archivos (`file://…` o
 * rutas absolutas, una por línea), se tratan como adjuntos y no como texto.
 */
export function filePathsFromPastedText(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > MAX_CLIPBOARD_FILES) return [];
  if (lines.every((l) => l.startsWith("file://"))) return filePathsFromUriList(text);
  if (lines.every((l) => /^(\/|~\/)[^\0]+\.[A-Za-z0-9]{1,8}$/.test(l))) return lines;
  return [];
}

/** Archivos copiados desde un gestor de archivos (Nautilus, Thunar, Dolphin…): sus rutas. */
export async function readClipboardFiles(deps: ClipboardDeps = {}): Promise<string[]> {
  const spawn = deps.spawn ?? defaultSpawn;
  const list = await run(spawn, ["wl-paste", "--list-types"]);
  if (list === null) return [];
  const types = new Set(new TextDecoder().decode(list).split("\n").map((l) => l.trim()));
  const type = FILE_LIST_TYPES.find((t) => types.has(t));
  if (type === undefined) return [];
  const bytes = await run(spawn, ["wl-paste", "--no-newline", "--type", type]);
  return bytes === null ? [] : filePathsFromUriList(new TextDecoder().decode(bytes));
}
