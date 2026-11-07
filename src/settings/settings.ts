import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import { settingsPath } from "../config/paths";

const VERSION = 1;

export type InputMode = "voice_activity" | "push_to_talk";
export type VadSensitivity = "auto" | number;
export type ThemeName = "dark" | "light";

export interface Settings {
  version: typeof VERSION;
  inputMode: InputMode;
  vadSensitivity: VadSensitivity;
  inputDevice: string | null;
  outputDevice: string | null;
  userVolumes: Record<string, number>;
  theme: ThemeName;
  idleAfterMinutes: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  version: VERSION,
  inputMode: "voice_activity",
  vadSensitivity: "auto",
  inputDevice: null,
  outputDevice: null,
  userVolumes: {},
  theme: "dark",
  idleAfterMinutes: 10,
};

const MIN_SENSITIVITY = -60;
const MAX_SENSITIVITY = -20;
const MIN_VOLUME = 0;
const MAX_VOLUME = 200;

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseSensitivity(value: unknown): VadSensitivity {
  if (value === "auto") return "auto";
  if (typeof value === "number" && Number.isFinite(value)) return clamp(value, MIN_SENSITIVITY, MAX_SENSITIVITY);
  return DEFAULT_SETTINGS.vadSensitivity;
}

function parseVolumes(value: unknown): Record<string, number> {
  const record = asRecord(value);
  if (!record) return { ...DEFAULT_SETTINGS.userVolumes };
  const out: Record<string, number> = {};
  for (const [userId, raw] of Object.entries(record)) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const volume = Math.round(clamp(raw, MIN_VOLUME, MAX_VOLUME));
    if (volume === MIN_VOLUME && raw <= MIN_VOLUME) continue;
    out[userId] = volume;
  }
  return out;
}

function parseDevice(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseIdle(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  return DEFAULT_SETTINGS.idleAfterMinutes;
}

/** Normaliza un objeto arbitrario a `Settings`, campo por campo (un campo inválido no tumba al resto). */
export function normalizeSettings(raw: unknown): Settings {
  const record = asRecord(raw);
  if (!record) return { ...DEFAULT_SETTINGS };

  return {
    version: VERSION,
    inputMode:
      record.inputMode === "push_to_talk" || record.inputMode === "voice_activity"
        ? record.inputMode
        : DEFAULT_SETTINGS.inputMode,
    vadSensitivity: parseSensitivity(record.vadSensitivity),
    inputDevice: parseDevice(record.inputDevice),
    outputDevice: parseDevice(record.outputDevice),
    userVolumes: parseVolumes(record.userVolumes),
    theme: record.theme === "light" || record.theme === "dark" ? record.theme : DEFAULT_SETTINGS.theme,
    idleAfterMinutes: parseIdle(record.idleAfterMinutes),
  };
}

export async function loadSettings(opts?: { path?: string }): Promise<Settings> {
  const path = opts?.path ?? settingsPath();
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isEnoent(error)) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS };
  }
  try {
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings, opts?: { path?: string }): Promise<void> {
  const path = opts?.path ?? settingsPath();
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const tmp = join(dir, `.settings.${process.pid}.${Date.now()}.tmp`);
  const fd = await open(tmp, "wx", 0o600);
  try {
    await fd.writeFile(JSON.stringify(settings, null, 2) + "\n");
    await fd.sync();
    await fd.close();
  } catch (error) {
    await fd.close().catch(() => {});
    await unlink(tmp).catch(() => {});
    throw error;
  }
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}
