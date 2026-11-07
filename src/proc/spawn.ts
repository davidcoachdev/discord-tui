import type { Subprocess } from "bun";

const ALLOWED = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "WAYLAND_DISPLAY",
  "PIPEWIRE_RUNTIME_DIR",
  "PULSE_SERVER",
];

export function cleanEnv(src: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ALLOWED) {
    const value = src[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function spawnClean(cmd: string[], opts?: { stdin?: "pipe" | "ignore"; stdout?: "pipe" | "ignore" }): Subprocess {
  return Bun.spawn(cmd, {
    env: cleanEnv(),
    stdin: opts?.stdin ?? "ignore",
    stdout: opts?.stdout ?? "pipe",
  });
}
