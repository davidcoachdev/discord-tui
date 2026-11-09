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

export function logPath(): string {
  return join(stateDir(), "discord-tui.log");
}
