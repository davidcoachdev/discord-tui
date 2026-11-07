import { FRAME_BYTES, FRAME_MS } from "./constants";
import { applyGain } from "./gain";
import { createJitterBuffer, type JitterBuffer } from "./jitter";

const MAX_CATCH_UP_FRAMES = 5;

/** Suma frames s16le saturando a [-32768, 32767]. Sin frames → silencio de FRAME_BYTES. */
export function mixFrames(frames: Uint8Array[]): Uint8Array {
  const length = frames.length === 0 ? FRAME_BYTES : Math.max(...frames.map((f) => f.byteLength));
  const out = new Uint8Array(length);
  if (frames.length === 0) return out;
  const output = new DataView(out.buffer);
  const views = frames.map((f) => new DataView(f.buffer, f.byteOffset, f.byteLength));
  for (let offset = 0; offset + 1 < length; offset += 2) {
    let sum = 0;
    for (const view of views) {
      if (offset + 1 < view.byteLength) sum += view.getInt16(offset, true);
    }
    output.setInt16(offset, Math.max(-32768, Math.min(32767, sum)), true);
  }
  return out;
}

export interface Mixer {
  buffer(userId: string): JitterBuffer;
  remove(userId: string): void;
  start(): void;
  stop(): void;
  setMuted(m: boolean): void;
  activeUsers(): string[];
}

export function createMixer(deps: {
  playback: { write(pcm: Uint8Array): void };
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  gainFor?: (userId: string) => number;
}): Mixer {
  const now = deps.now ?? ((): number => performance.now());
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number): unknown => setInterval(fn, ms));
  const clearTimer =
    deps.clearTimer ?? ((h: unknown): void => clearInterval(h as ReturnType<typeof setInterval>));
  const buffers = new Map<string, JitterBuffer>();
  let muted = false;
  let timer: unknown = null;
  let clock = 0;

  function mixSlot(): void {
    const frames: Uint8Array[] = [];
    for (const [userId, jb] of buffers) {
      const frame = jb.pop();
      if (!frame) continue;
      const gain = deps.gainFor?.(userId);
      frames.push(gain !== undefined && gain !== 100 ? applyGain(frame, gain) : frame);
    }
    if (muted || frames.length === 0) return;
    deps.playback.write(mixFrames(frames));
  }

  function tick(): void {
    const t = now();
    const due = Math.floor((t - clock) / FRAME_MS);
    if (due <= 0) return;
    if (due > MAX_CATCH_UP_FRAMES) {
      for (let i = 0; i < MAX_CATCH_UP_FRAMES; i += 1) mixSlot();
      clock = t;
      return;
    }
    for (let i = 0; i < due; i += 1) mixSlot();
    clock += due * FRAME_MS;
  }

  return {
    buffer(userId: string): JitterBuffer {
      let jb = buffers.get(userId);
      if (!jb) {
        jb = createJitterBuffer();
        buffers.set(userId, jb);
      }
      return jb;
    },
    remove(userId: string): void {
      buffers.delete(userId);
    },
    start(): void {
      if (timer !== null) return;
      clock = now();
      timer = setTimer(tick, FRAME_MS);
    },
    stop(): void {
      if (timer === null) return;
      clearTimer(timer);
      timer = null;
    },
    setMuted(m: boolean): void {
      muted = m;
    },
    activeUsers(): string[] {
      return [...buffers.keys()];
    },
  };
}
