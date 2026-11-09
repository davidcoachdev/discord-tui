import { homedir } from "node:os";
import { join } from "node:path";

function xdg(name: "XDG_CONFIG_HOME" | "XDG_STATE_HOME", fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

export function configDir(): string {
  return join(xdg("XDG_CONFIG_HOME", join(homedir(), ".config")), "discord-tui");
}

export function stateDir(): string {
  return join(xdg("XDG_STATE_HOME", join(homedir(), ".local", "state")), "discord-tui");
}

export function sessionPath(): string {
  return join(configDir(), "session.json");
}

export function settingsPath(): string {
  return join(configDir(), "settings.json");
}

/** Carpeta efímera (tmpfs de la sesión): `DISCORD_TUI_RUNTIME_DIR` o `$XDG_RUNTIME_DIR/discord-tui`. */
export function runtimeDir(): string {
  const override = process.env.DISCORD_TUI_RUNTIME_DIR;
  if (override && override.length > 0) return override;
  const base = process.env.XDG_RUNTIME_DIR;
  return join(base && base.length > 0 ? base : join("/run/user", String(process.getuid?.() ?? 1000)), "discord-tui");
}

/** Eventos de la llamada (quién habla, quién entra) para eco: un JSON por línea. */
export function voiceFeedPath(): string {
  return join(runtimeDir(), "voz.jsonl");
}

export function logPath(): string {
  return join(stateDir(), "discord-tui.log");
}
