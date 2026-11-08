import { MIN_DELAY_MS } from "./gif";

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface AnimationHandle {
  stop(): void;
}

export interface Scheduler {
  /**
   * Avanza `delays.length` cuadros en loop llamando `onFrame(índice)`. Si `visible()` da false en un
   * turno, ese cuadro no avanza (la imagen quedó fuera de pantalla) y se vuelve a mirar después.
   */
  add(delays: number[], onFrame: (index: number) => void, visible?: () => boolean): AnimationHandle;
  /** Terminal sin foco: se frena todo y no queda timer vivo. */
  setPaused(paused: boolean): void;
  readonly paused: boolean;
  readonly size: number;
}

interface Entry {
  delays: number[];
  index: number;
  nextAt: number;
  onFrame(index: number): void;
  visible(): boolean;
}

/** Un solo timer para todas las animaciones: se programa al próximo cuadro que vence. */
export function createScheduler(clock: Clock = realClock): Scheduler {
  const entries = new Set<Entry>();
  let timer: unknown = null;
  let dueAt = Infinity;
  let paused = false;

  function clear(): void {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    dueAt = Infinity;
  }

  function schedule(): void {
    if (paused || entries.size === 0) return clear();
    let next = Infinity;
    for (const entry of entries) next = Math.min(next, entry.nextAt);
    if (timer !== null && next === dueAt) return;
    clear();
    dueAt = next;
    timer = clock.setTimeout(tick, Math.max(0, next - clock.now()));
  }

  function tick(): void {
    timer = null;
    dueAt = Infinity;
    const now = clock.now();
    for (const entry of [...entries]) {
      if (entry.nextAt > now || !entries.has(entry)) continue;
      if (!entry.visible()) {
        entry.nextAt = now + entry.delays[entry.index]!;
        continue;
      }
      // Avanza los cuadros vencidos; si el atraso es grande (proceso dormido) no se pone a ponerse al día.
      let steps = 0;
      while (entry.nextAt <= now && steps < entry.delays.length) {
        entry.index = (entry.index + 1) % entry.delays.length;
        entry.nextAt += entry.delays[entry.index]!;
        steps++;
      }
      if (entry.nextAt <= now) entry.nextAt = now + entry.delays[entry.index]!;
      entry.onFrame(entry.index);
    }
    schedule();
  }

  return {
    get paused() {
      return paused;
    },
    get size() {
      return entries.size;
    },
    add(delays, onFrame, visible = () => true) {
      const clamped = delays.map((d) => Math.max(MIN_DELAY_MS, Number.isFinite(d) ? d : MIN_DELAY_MS));
      if (clamped.length < 2) return { stop() {} };
      const entry: Entry = { delays: clamped, index: 0, nextAt: clock.now() + clamped[0]!, onFrame, visible };
      entries.add(entry);
      schedule();
      return {
        stop() {
          if (!entries.delete(entry)) return;
          schedule();
        },
      };
    },
    setPaused(value) {
      if (paused === value) return;
      paused = value;
      if (!paused) {
        const now = clock.now();
        for (const entry of entries) entry.nextAt = now + entry.delays[entry.index]!;
      }
      schedule();
    },
  };
}

export const animationScheduler = createScheduler();
