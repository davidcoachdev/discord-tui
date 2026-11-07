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
    if (code !== 0 || bytes.byteLength === 0) return null;
    return bytes;
  } catch {
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
