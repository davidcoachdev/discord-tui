import { spawnClean } from "./spawn";

/** Abre un link en el navegador con xdg-open: solo https, como argumento (nunca por shell), con env limpio. */
export function openUrl(url: string, deps: { spawn?: (cmd: string[]) => unknown } = {}): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const spawn = deps.spawn ?? ((cmd: string[]) => spawnClean(cmd, { stdout: "ignore" }));
  try {
    spawn(["xdg-open", parsed.toString()]);
    return true;
  } catch {
    return false;
  }
}
