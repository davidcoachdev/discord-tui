export type PttMode = "hold" | "toggle";

export interface PttKey {
  name: string;
  eventType: "press" | "repeat" | "release";
  repeated?: boolean;
}

export interface Ptt {
  onKey(e: PttKey): void;
  readonly transmitting: boolean;
  readonly mode: PttMode;
  readonly warning: string | null;
  onChange(fn: () => void): () => void;
  reset(): void;
}

export const PTT_TOGGLE_WARNING = "tu terminal no avisa cuando soltás la tecla: el PTT funciona como interruptor";

export function createPtt(opts: { kittyKeyboard: boolean }): Ptt {
  let transmitting = false;
  let mode: PttMode = opts.kittyKeyboard ? "hold" : "toggle";
  let warning: string | null = opts.kittyKeyboard ? null : PTT_TOGGLE_WARNING;
  const listeners = new Set<() => void>();

  function set(next: { transmitting?: boolean; mode?: PttMode; warning?: string | null }): void {
    const before = `${transmitting}|${mode}|${warning}`;
    if (next.transmitting !== undefined) transmitting = next.transmitting;
    if (next.mode !== undefined) mode = next.mode;
    if (next.warning !== undefined) warning = next.warning;
    if (`${transmitting}|${mode}|${warning}` === before) return;
    for (const fn of [...listeners]) fn();
  }

  return {
    onKey(e: PttKey): void {
      if (e.name !== "space") return;
      const repeat = e.eventType === "repeat" || e.repeated === true;
      if (mode === "toggle") {
        if (e.eventType === "press" && !repeat) set({ transmitting: !transmitting });
        return;
      }
      if (e.eventType === "release") {
        set({ transmitting: false });
        return;
      }
      if (repeat) return;
      if (transmitting) {
        set({ transmitting: false, mode: "toggle", warning: PTT_TOGGLE_WARNING });
        return;
      }
      set({ transmitting: true });
    },
    get transmitting(): boolean {
      return transmitting;
    },
    get mode(): PttMode {
      return mode;
    },
    get warning(): string | null {
      return warning;
    },
    onChange(fn: () => void): () => void {
      listeners.add(fn);
      return (): void => {
        listeners.delete(fn);
      };
    },
    reset(): void {
      set({ transmitting: false });
    },
  };
}
