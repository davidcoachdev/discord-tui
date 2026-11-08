import { expect, test } from "bun:test";

import { createScheduler, type Clock } from "../../src/images/animation";

/** Reloj falso: un solo timer a la vez es lo que esperamos del scheduler; `timers` cuenta los vivos. */
function fakeClock() {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => void timers.delete(id as number),
  };
  function advance(ms: number): void {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!due || due[1].at > end) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  }
  return { clock, advance, timers };
}

test("frames advance by each frame's delay and loop", () => {
  const { clock, advance } = fakeClock();
  const s = createScheduler(clock);
  const seen: number[] = [];
  s.add([100, 200, 50], (i) => seen.push(i));
  advance(99);
  expect(seen).toEqual([]);
  advance(1);
  expect(seen).toEqual([1]);
  advance(199);
  expect(seen).toEqual([1]);
  advance(1);
  expect(seen).toEqual([1, 2]);
  advance(50);
  expect(seen).toEqual([1, 2, 0]);
});

test("delays under 40 ms are clamped to 40 (≤ 25 fps)", () => {
  const { clock, advance } = fakeClock();
  const s = createScheduler(clock);
  const seen: number[] = [];
  s.add([10, 10], (i) => seen.push(i));
  advance(1000);
  expect(seen).toHaveLength(25);
});

test("one shared timer for many animations, none when nothing animates", () => {
  const { clock, advance, timers } = fakeClock();
  const s = createScheduler(clock);
  const a: number[] = [];
  const b: number[] = [];
  const ha = s.add([100, 100], (i) => a.push(i));
  const hb = s.add([50, 50, 50], (i) => b.push(i));
  expect(timers.size).toBe(1);
  advance(200);
  expect(a).toEqual([1, 0]);
  expect(b).toEqual([1, 2, 0, 1]);
  expect(timers.size).toBe(1);
  ha.stop();
  hb.stop();
  expect(s.size).toBe(0);
  expect(timers.size).toBe(0);
  advance(1000);
  expect(a).toHaveLength(2);
});

test("pause stops everything (no live timer); resume restarts from the current frame", () => {
  const { clock, advance, timers } = fakeClock();
  const s = createScheduler(clock);
  const seen: number[] = [];
  s.add([100, 100, 100], (i) => seen.push(i));
  advance(100);
  s.setPaused(true);
  expect(timers.size).toBe(0);
  advance(5000);
  expect(seen).toEqual([1]);
  s.setPaused(false);
  advance(99);
  expect(seen).toEqual([1]);
  advance(1);
  expect(seen).toEqual([1, 2]);
});

test("off-screen animations hold their frame and pick up again when visible", () => {
  const { clock, advance } = fakeClock();
  const s = createScheduler(clock);
  let visible = false;
  const seen: number[] = [];
  s.add([100, 100], (i) => seen.push(i), () => visible);
  advance(1000);
  expect(seen).toEqual([]);
  visible = true;
  advance(100);
  expect(seen).toEqual([1]);
});

test("a long stall does not replay every missed frame", () => {
  let now = 0;
  let pending: (() => void) | null = null;
  const s = createScheduler({ now: () => now, setTimeout: (fn) => ((pending = fn), 1), clearTimeout: () => (pending = null) });
  const seen: number[] = [];
  s.add([100, 100, 100], (i) => seen.push(i));
  now = 60_000; // el proceso estuvo dormido un minuto
  pending!();
  expect(seen).toHaveLength(1);
});

test("single-frame or empty animations never schedule", () => {
  const { clock, timers } = fakeClock();
  const s = createScheduler(clock);
  s.add([100], () => {}).stop();
  s.add([], () => {});
  expect(s.size).toBe(0);
  expect(timers.size).toBe(0);
});
