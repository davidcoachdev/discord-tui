import type { Logger } from "../log/logger";

/** Cada 60 s loguea paquetes recibidos y errores de decodificación (sin ids de usuarios). */
export function createVoiceStats(deps: {
  log: Pick<Logger, "info">;
  read(): { packets: number; decodeErrors: number; state: string };
  every?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): { stop(): void } {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number): unknown => setInterval(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown): void => clearInterval(handle as ReturnType<typeof setInterval>));
  const handle = setTimer(() => {
    const { packets, decodeErrors, state } = deps.read();
    deps.log.info("voice.stats", { packets, decode_errors: decodeErrors, state });
  }, deps.every ?? 60_000);
  (handle as { unref?: () => void } | null)?.unref?.();
  return { stop: () => clearTimer(handle) };
}
