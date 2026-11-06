import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

import { configDir, sessionPath } from "../config/paths";
import { Secret } from "../secret";

const VERSION = 1;

export interface Session {
  token: Secret;
  userId: string;
  buildNumber: number | null;
}

export class SessionPermissionError extends Error {
  readonly mode: number;

  constructor(mode: number) {
    super(`session file has mode ${mode.toString(8)}; expected 600`);
    this.name = "SessionPermissionError";
    this.mode = mode;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

export async function saveSession(session: Session): Promise<void> {
  const dir = configDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);

  const target = sessionPath();
  const tmp = join(dir, `.session.${process.pid}.${Date.now()}.tmp`);
  const fd = await open(tmp, "wx", 0o600);
  try {
    const body = JSON.stringify({
      version: VERSION,
      token: session.token.reveal(),
      user_id: session.userId,
      client_build_number: session.buildNumber,
    });
    await fd.writeFile(body + "\n");
    await fd.sync();
    await fd.close();
  } catch (error) {
    await fd.close().catch(() => {});
    await unlink(tmp).catch(() => {});
    throw error;
  }
  await rename(tmp, target);
}

export async function loadSession(): Promise<Session | null> {
  const path = sessionPath();

  let mode: number;
  try {
    mode = (await stat(path)).mode & 0o777;
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
  if (mode !== 0o600) throw new SessionPermissionError(mode);

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const record = asRecord(parsed);
  if (!record || record.version !== VERSION) return null;
  if (typeof record.token !== "string" || typeof record.user_id !== "string") return null;
  if (record.client_build_number !== null && typeof record.client_build_number !== "number") return null;

  return {
    token: new Secret(record.token),
    userId: record.user_id,
    buildNumber: record.client_build_number,
  };
}

export async function deleteSession(): Promise<boolean> {
  try {
    await unlink(sessionPath());
    return true;
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}
