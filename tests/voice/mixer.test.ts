import { describe, expect, test } from "bun:test";

import { createMixer, mixFrames } from "../../src/voice/mixer";
import { pcmOf, sampleAt } from "../helpers/pcm";

interface Harness {
  writes: Uint8Array[];
  advance(ms: number): void;
  tick(): void;
  cleared: boolean;
  mixer: ReturnType<typeof createMixer>;
}

function harness(gainFor?: (userId: string) => number): Harness {
  let t = 1000;
  let fn: (() => void) | null = null;
  const h: Harness = {
    writes: [],
    cleared: false,
    advance(ms: number): void {
      t += ms;
      fn?.();
    },
    tick(): void {
      fn?.();
    },
    mixer: undefined as unknown as ReturnType<typeof createMixer>,
  };
  h.mixer = createMixer({
    playback: { write: (pcm) => h.writes.push(pcm) },
    now: () => t,
    setTimer: (f) => {
      fn = f;
      return 1;
    },
    clearTimer: () => {
      fn = null;
      h.cleared = true;
    },
    gainFor,
  });
  return h;
}

function fill(h: Harness, userId: string, sample: number, count: number): void {
  const jb = h.mixer.buffer(userId);
  for (let i = 0; i < count; i += 1) jb.push(pcmOf(sample));
}

describe("mixFrames", () => {
  test("saturates", () => {
    expect(sampleAt(mixFrames([pcmOf(30000), pcmOf(30000)]), 0)).toBe(32767);
    expect(sampleAt(mixFrames([pcmOf(-30000), pcmOf(-30000)]), 0)).toBe(-32768);
  });

  test("sums samples", () => {
    expect(sampleAt(mixFrames([pcmOf(100), pcmOf(-30)]), 5)).toBe(70);
  });

  test("no frames gives 3840 zero bytes", () => {
    const out = mixFrames([]);
    expect(out.length).toBe(3840);
    expect(out.every((b) => b === 0)).toBe(true);
  });
});

describe("createMixer", () => {
  test("writes one frame per 20 ms and catches up after a 60 ms stall", () => {
    const h = harness();
    fill(h, "a", 10, 10);
    h.mixer.start();
    h.advance(10);
    expect(h.writes.length).toBe(0);
    h.advance(10);
    expect(h.writes.length).toBe(1);
    h.advance(20);
    expect(h.writes.length).toBe(2);
    h.advance(60);
    expect(h.writes.length).toBe(5);
    expect(sampleAt(h.writes[0]!, 0)).toBe(10);
  });

  test("resyncs when lag exceeds 100 ms", () => {
    const h = harness();
    fill(h, "a", 10, 10);
    h.mixer.start();
    h.advance(300);
    expect(h.writes.length).toBe(5);
    h.advance(10);
    expect(h.writes.length).toBe(5);
    h.advance(10);
    expect(h.writes.length).toBe(6);
  });

  test("writes nothing when no user produced a frame", () => {
    const h = harness();
    h.mixer.buffer("a");
    h.mixer.start();
    h.advance(100);
    expect(h.writes.length).toBe(0);
  });

  test("muted mixer writes nothing and discards buffers", () => {
    const h = harness();
    fill(h, "a", 10, 5);
    h.mixer.setMuted(true);
    h.mixer.start();
    h.advance(60);
    expect(h.writes.length).toBe(0);
    expect(h.mixer.buffer("a").size).toBe(2);
    h.mixer.setMuted(false);
    h.advance(20);
    expect(h.writes.length).toBe(1);
  });

  test("applies gain per user", () => {
    const h = harness((id) => (id === "a" ? 50 : 100));
    fill(h, "a", 1000, 3);
    fill(h, "b", 1000, 3);
    h.mixer.start();
    h.advance(20);
    expect(sampleAt(h.writes[0]!, 0)).toBe(1500);
  });

  test("users with empty buffers don't block others", () => {
    const h = harness();
    fill(h, "a", 10, 3);
    fill(h, "b", 20, 1);
    h.mixer.start();
    h.advance(20);
    expect(h.writes.length).toBe(1);
    expect(sampleAt(h.writes[0]!, 0)).toBe(10);
  });

  test("buffer is created on demand and reused; remove and activeUsers", () => {
    const h = harness();
    const jb = h.mixer.buffer("a");
    expect(h.mixer.buffer("a")).toBe(jb);
    h.mixer.buffer("b");
    expect(h.mixer.activeUsers().sort()).toEqual(["a", "b"]);
    h.mixer.remove("a");
    expect(h.mixer.activeUsers()).toEqual(["b"]);
  });

  test("stop clears the timer", () => {
    const h = harness();
    fill(h, "a", 10, 5);
    h.mixer.start();
    h.mixer.stop();
    expect(h.cleared).toBe(true);
    h.advance(100);
    expect(h.writes.length).toBe(0);
  });
});
