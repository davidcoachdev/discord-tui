/**
 * Captura de pantalla para Go Live: backend de captura (wf-recorder → grim en loop → nada), lista de
 * monitores de Hyprland y el ffmpeg que saca H264 (NUT por stdout) para `playStream`.
 *
 * Privacidad: nada se escribe a disco; los frames van de proceso a proceso por pipes. Todos los procesos
 * corren con env limpio (`spawnClean`) y sin el token. `stop()` los mata a todos (SIGTERM y, si no
 * salen, SIGKILL): no quedan procesos huérfanos.
 */
import { existsSync } from "node:fs";
import { Readable } from "node:stream";

import { log } from "../log/logger";
import { spawnClean } from "../proc/spawn";
import type { StreamQuality } from "../settings/settings";

export type CaptureBackend = "wf-recorder" | "grim";
export type VideoEncoder = "nvenc" | "vaapi" | "x264";

export interface Monitor {
  /** Nombre de salida de Wayland (`DP-1`); "" = el predeterminado (sin `-o`). */
  name: string;
  width: number;
  height: number;
  focused: boolean;
}

export interface Quality {
  width: number;
  height: number;
  fps: number;
  bitrateK: number;
  maxrateK: number;
}

export const QUALITY: Record<StreamQuality, Quality> = {
  "720p30": { width: 1280, height: 720, fps: 30, bitrateK: 2500, maxrateK: 3500 },
  "1080p30": { width: 1920, height: 1080, fps: 30, bitrateK: 4500, maxrateK: 6000 },
};

/** Keyframe cada tantos segundos: el que entra a mirar arranca en el próximo. */
export const KEYFRAME_SECONDS = 2;
/** grim en loop rinde ~10 fps a resolución completa (spike 2026-11-08). */
export const GRIM_FPS = 10;
export const VAAPI_DEVICE = "/dev/dri/renderD128";

/** Lo mínimo de un subproceso de Bun que usamos (inyectable para los tests). */
export interface ProcLike {
  readonly pid: number;
  readonly stdout: ReadableStream<Uint8Array> | number | null | undefined;
  readonly stdin?: { write(chunk: Uint8Array): unknown; flush?(): unknown; end?(): unknown } | number | null | undefined;
  readonly stderr?: ReadableStream<Uint8Array> | number | null | undefined;
  readonly exited: Promise<number>;
  readonly exitCode?: number | null;
  kill(signal?: number | NodeJS.Signals): void;
}

export interface SpawnOpts {
  stdin?: "pipe" | "ignore" | ReadableStream<Uint8Array>;
  stdout?: "pipe" | "ignore";
  stderr?: "pipe" | "ignore";
}

export type SpawnFn = (cmd: string[], opts: SpawnOpts) => ProcLike;

export interface CaptureEnv {
  spawn: SpawnFn;
  which(bin: string): boolean;
  exists(path: string): boolean;
}

export const defaultCaptureEnv: CaptureEnv = {
  spawn: (cmd, opts) => spawnClean(cmd, opts) as unknown as ProcLike,
  which: (bin) => Bun.which(bin) !== null,
  exists: (path) => existsSync(path),
};

const MONITOR_NAME = /^[A-Za-z0-9._-]{1,40}$/;

export function isValidMonitorName(name: string): boolean {
  return name === "" || MONITOR_NAME.test(name);
}

/** Backend de captura: wf-recorder (fluido) → grim en loop (lento) → null (no hay con qué). */
export function pickBackend(which: (bin: string) => boolean): CaptureBackend | null {
  if (which("wf-recorder")) return "wf-recorder";
  if (which("grim")) return "grim";
  return null;
}

/** `hyprctl monitors -j` → monitores; descarta los raros. */
export function parseHyprMonitors(raw: unknown): Monitor[] {
  if (!Array.isArray(raw)) return [];
  const out: Monitor[] = [];
  for (const m of raw) {
    if (typeof m?.name !== "string" || !MONITOR_NAME.test(m.name)) continue;
    if (m.disabled === true) continue;
    out.push({
      name: m.name,
      width: typeof m.width === "number" ? m.width : 0,
      height: typeof m.height === "number" ? m.height : 0,
      focused: m.focused === true,
    });
  }
  return out;
}

export const DEFAULT_MONITOR: Monitor = { name: "", width: 0, height: 0, focused: true };

async function readAll(stream: ProcLike["stdout"]): Promise<string> {
  if (!stream || typeof stream === "number") return "";
  return new Response(stream).text();
}

/** Monitores de Hyprland; si no hay `hyprctl` (u otra cosa falla), uno solo: el predeterminado. */
export async function listMonitors(env: CaptureEnv = defaultCaptureEnv, timeoutMs = 2_000): Promise<Monitor[]> {
  if (!env.which("hyprctl")) return [DEFAULT_MONITOR];
  try {
    const proc = env.spawn(["hyprctl", "monitors", "-j"], { stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    const text = await readAll(proc.stdout);
    await proc.exited;
    clearTimeout(timer);
    const monitors = parseHyprMonitors(JSON.parse(text));
    return monitors.length > 0 ? monitors : [DEFAULT_MONITOR];
  } catch {
    return [DEFAULT_MONITOR];
  }
}

/** Comando de wf-recorder: wlr-screencopy sin portal, video crudo yuv420p a 30 fps, NUT por stdout. */
export function wfRecorderCommand(monitor: string, quality: Pick<Quality, "fps">): string[] {
  return [
    "wf-recorder",
    "-y",
    ...(monitor ? ["-o", monitor] : []),
    "-c",
    "rawvideo",
    "-m",
    "nut",
    "-x",
    "yuv420p",
    "-r",
    String(quality.fps),
    // Sin `-F scale=…`: con video crudo y un filtro, wf-recorder 0.6.0 saca solo el encabezado NUT (probado
    // 2026-11-08). Achica ffmpeg.
    // `pipe:1` y no `/dev/stdout`: los pipes de Bun no se pueden reabrir por path ("avio_open failed").
    "-f",
    "pipe:1",
  ];
}

/** Un frame con grim (PPM por stdout). */
export function grimCommand(monitor: string): string[] {
  return ["grim", "-t", "ppm", ...(monitor ? ["-o", monitor] : []), "-"];
}

/** Achica a la caja de la calidad manteniendo el aspecto (nunca agranda), con lados pares. */
export function scaleFilter(quality: Quality): string {
  return `scale='min(${quality.width},iw)':'min(${quality.height},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
}

/** Argumentos de ffmpeg: entrada por stdin, H264 de baja latencia, keyframe (IDR) cada 2 s, NUT por stdout. */
export function ffmpegArgs(opts: { backend: CaptureBackend; encoder: VideoEncoder; quality: Quality }): string[] {
  const { backend, encoder, quality } = opts;
  const gop = String(quality.fps * KEYFRAME_SECONDS);
  const input =
    backend === "wf-recorder"
      ? ["-fflags", "nobuffer", "-flags", "low_delay", "-probesize", "32768", "-analyzeduration", "0", "-f", "nut", "-i", "pipe:0"]
      : ["-f", "image2pipe", "-c:v", "ppm", "-framerate", String(GRIM_FPS), "-i", "pipe:0"];
  const filters = [scaleFilter(quality), `fps=${quality.fps}`, ...(encoder === "vaapi" ? ["format=nv12", "hwupload"] : ["format=yuv420p"])];
  const codec =
    encoder === "nvenc"
      ? ["-c:v", "h264_nvenc", "-preset", "p1", "-tune", "ll", "-zerolatency", "1", "-rc", "cbr", "-forced-idr", "1"]
      : encoder === "vaapi"
        ? ["-c:v", "h264_vaapi"]
        : ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-forced-idr", "1"];
  return [
    "ffmpeg",
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    ...(encoder === "vaapi" ? ["-vaapi_device", VAAPI_DEVICE] : []),
    ...input,
    "-an",
    "-vf",
    filters.join(","),
    ...codec,
    "-b:v",
    `${quality.bitrateK}k`,
    "-maxrate",
    `${quality.maxrateK}k`,
    "-bufsize",
    `${Math.round(quality.bitrateK / 2)}k`,
    "-bf",
    "0",
    "-g",
    gop,
    "-keyint_min",
    gop,
    "-force_key_frames",
    `expr:gte(t,n_forced*${KEYFRAME_SECONDS})`,
    "-flush_packets",
    "1",
    "-f",
    "nut",
    "pipe:1",
  ];
}

/** Prueba un encoder con 1 frame sintético (sin capturar nada). */
export function probeArgs(encoder: Exclude<VideoEncoder, "x264">): string[] {
  const src = ["-f", "lavfi", "-i", "color=c=black:s=256x144:d=0.1"];
  return encoder === "nvenc"
    ? ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error", ...src, "-frames:v", "1", "-c:v", "h264_nvenc", "-f", "null", "-"]
    : [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-vaapi_device",
        VAAPI_DEVICE,
        ...src,
        "-vf",
        "format=nv12,hwupload",
        "-frames:v",
        "1",
        "-c:v",
        "h264_vaapi",
        "-f",
        "null",
        "-",
      ];
}

async function probe(env: CaptureEnv, cmd: string[], timeoutMs: number): Promise<boolean> {
  try {
    const proc = env.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    const code = await proc.exited;
    clearTimeout(timer);
    return code === 0;
  } catch {
    return false;
  }
}

let cachedEncoder: Promise<VideoEncoder> | null = null;

/** Encoder por hardware si anda (NVENC, después VAAPI), si no libx264. Se prueba una vez por proceso. */
export function pickEncoder(env: CaptureEnv = defaultCaptureEnv, opts: { cache?: boolean; timeoutMs?: number } = {}): Promise<VideoEncoder> {
  const run = async (): Promise<VideoEncoder> => {
    const timeoutMs = opts.timeoutMs ?? 3_000;
    if (await probe(env, probeArgs("nvenc"), timeoutMs)) return "nvenc";
    if (env.exists(VAAPI_DEVICE) && (await probe(env, probeArgs("vaapi"), timeoutMs))) return "vaapi";
    return "x264";
  };
  if (opts.cache === false) return run();
  cachedEncoder ??= run();
  return cachedEncoder;
}

export interface CaptureHandle {
  /** H264 en NUT, para `playStream(…, { format: "nut" })`. */
  readonly output: Readable;
  /** Resuelve cuando la captura termina sola (no por `stop()`). */
  readonly ended: Promise<void>;
  /** Pids vivos de la captura (para tests y diagnóstico). */
  pids(): number[];
  /** Mata todo y espera a que salga. Idempotente. */
  stop(): Promise<void>;
}

const KILL_GRACE_MS = 1_500;

async function killAndWait(proc: ProcLike): Promise<void> {
  if (proc.exitCode !== undefined && proc.exitCode !== null) return;
  try {
    proc.kill("SIGTERM");
  } catch {
    // ya había salido
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const forced = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ya había salido
      }
      resolve();
    }, KILL_GRACE_MS);
  });
  await Promise.race([proc.exited.then(() => {}), forced]);
  if (timer) clearTimeout(timer);
  await proc.exited.catch(() => {});
}

/** Lo último que dijo ffmpeg por stderr (sin datos de la cuenta: solo errores de medios), para el log. */
function tailStderr(proc: ProcLike): { text(): string } {
  let tail = "";
  const stream = proc.stderr;
  if (stream && typeof stream !== "number") {
    void (async () => {
      try {
        const decoder = new TextDecoder();
        for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
          tail = (tail + decoder.decode(chunk)).slice(-300);
        }
      } catch {
        // se cerró
      }
    })();
  }
  return { text: () => tail.trim() };
}

/**
 * Arranca captura → ffmpeg. Con wf-recorder el stdout de la captura va directo al stdin de ffmpeg; con
 * grim se saca un frame por vez en JS (un proceso `grim` corto por frame) y se escribe en ffmpeg.
 */
export function startCapture(opts: {
  backend: CaptureBackend;
  encoder: VideoEncoder;
  monitor: string;
  quality: Quality;
  env?: CaptureEnv;
}): CaptureHandle {
  const env = opts.env ?? defaultCaptureEnv;
  if (!isValidMonitorName(opts.monitor)) throw new Error("monitor inválido");
  let stopping = false;
  let current: ProcLike | null = null;
  const procs: ProcLike[] = [];
  const track = (proc: ProcLike): ProcLike => {
    procs.push(proc);
    void proc.exited.then(
      () => procs.splice(procs.indexOf(proc), 1),
      () => procs.splice(procs.indexOf(proc), 1),
    );
    return proc;
  };

  let capture: ProcLike | null = null;
  let ffmpeg: ProcLike;
  let loop: Promise<void> = Promise.resolve();
  const ffArgs = ffmpegArgs(opts);

  if (opts.backend === "wf-recorder") {
    capture = track(env.spawn(wfRecorderCommand(opts.monitor, opts.quality), { stdin: "ignore", stdout: "pipe", stderr: "ignore" }));
    const piped = capture.stdout && typeof capture.stdout !== "number" ? capture.stdout : "ignore";
    ffmpeg = track(env.spawn(ffArgs, { stdin: piped, stdout: "pipe", stderr: "pipe" }));
  } else {
    ffmpeg = track(env.spawn(ffArgs, { stdin: "pipe", stdout: "pipe", stderr: "pipe" }));
    const sink = ffmpeg.stdin && typeof ffmpeg.stdin !== "number" ? ffmpeg.stdin : null;
    loop = (async () => {
      let failures = 0;
      while (!stopping && sink) {
        const grim = track(env.spawn(grimCommand(opts.monitor), { stdin: "ignore", stdout: "pipe", stderr: "ignore" }));
        current = grim;
        const frame = new Uint8Array(await new Response(grim.stdout as ReadableStream<Uint8Array>).arrayBuffer().catch(() => new ArrayBuffer(0)));
        const code = await grim.exited.catch(() => 1);
        current = null;
        if (stopping) break;
        if (code !== 0 || frame.byteLength === 0) {
          failures += 1;
          if (failures >= 3) break;
          continue;
        }
        failures = 0;
        try {
          await sink.write(frame);
          await sink.flush?.();
        } catch {
          break;
        }
      }
      try {
        await sink?.end?.();
      } catch {
        // ffmpeg ya había salido
      }
    })();
  }

  const stderr = tailStderr(ffmpeg);
  const output =
    ffmpeg.stdout && typeof ffmpeg.stdout !== "number"
      ? Readable.fromWeb(ffmpeg.stdout as unknown as import("node:stream/web").ReadableStream<Uint8Array>)
      : Readable.from([]);

  const ended = ffmpeg.exited.then(
    (code) => {
      if (!stopping) log.warn("golive.capture-ended", { mode: opts.backend, close_code: code, msg: stderr.text().slice(0, 160) });
    },
    () => {},
  );

  let stopped: Promise<void> | null = null;
  return {
    output,
    ended: ended.then(() => {
      if (stopping) return new Promise<void>(() => {});
    }),
    pids: () => procs.map((p) => p.pid),
    stop(): Promise<void> {
      stopped ??= (async () => {
        stopping = true;
        output.destroy();
        const live = current;
        await Promise.all([capture ? killAndWait(capture) : null, live ? killAndWait(live) : null, killAndWait(ffmpeg)]);
        await loop;
        // un grim que arrancó justo mientras parábamos
        await Promise.all([...procs].map((p) => killAndWait(p)));
      })();
      return stopped;
    },
  };
}
