import { expect, test } from "bun:test";

import { SILENCE_FRAME } from "../../src/voice/constants";
import { createReceiver } from "../../src/voice/rx";

function harness(opts: { deaf?: boolean; failFor?: string } = {}) {
  const opusListeners = new Set<(userId: string, opus: Uint8Array) => void>();
  const speakingListeners = new Set<(userId: string, on: boolean) => void>();
  const pushed: Record<string, Uint8Array[]> = {};
  const removed: string[] = [];
  const speaking: [string, boolean][] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  let decoders = 0;
  let deaf = opts.deaf ?? false;
  const rx = createReceiver({
    session: {
      onOpus: (fn) => {
        opusListeners.add(fn);
        return () => opusListeners.delete(fn);
      },
      onSpeaking: (fn) => {
        speakingListeners.add(fn);
        return () => speakingListeners.delete(fn);
      },
    },
    mixer: {
      buffer: (userId) => ({
        push: (pcm: Uint8Array) => (pushed[userId] ??= []).push(pcm),
        pop: () => null,
        size: 0,
        reset: () => {},
      }),
      remove: (userId) => removed.push(userId),
    },
    makeDecoder: () => {
      decoders += 1;
      return {
        decode: (opus: Uint8Array) => {
          if (opus[0] === 0xee) throw new Error("bad");
          return Uint8Array.of(opus[0]!);
        },
      };
    },
    isDeaf: () => deaf,
    onSpeaking: (userId, on) => speaking.push([userId, on]),
    setTimer: ((fn: () => void, ms: number) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    }) as never,
    clearTimer: ((t: { cleared: boolean }) => {
      t.cleared = true;
    }) as never,
  });
  const opus = (userId: string, bytes: Uint8Array) => opusListeners.forEach((fn) => fn(userId, bytes));
  const fireTimers = () => timers.filter((t) => !t.cleared).forEach((t) => ((t.cleared = true), t.fn()));
  return { rx, opus, pushed, removed, speaking, fireTimers, decoders: () => decoders, setDeaf: (d: boolean) => (deaf = d) };
}

test("opus from two users is decoded into each user's buffer with one decoder each", () => {
  const h = harness();
  h.opus("a", Uint8Array.of(1));
  h.opus("b", Uint8Array.of(2));
  h.opus("a", Uint8Array.of(3));
  expect(h.pushed.a!.map((p) => p[0])).toEqual([1, 3]);
  expect(h.pushed.b!.map((p) => p[0])).toEqual([2]);
  expect(h.decoders()).toBe(2);
  expect(h.speaking).toEqual([["a", true], ["b", true]]);
});

test("five silence frames end speaking without decoding them", () => {
  const h = harness();
  h.opus("a", Uint8Array.of(1));
  for (let i = 0; i < 5; i += 1) h.opus("a", SILENCE_FRAME);
  expect(h.pushed.a).toHaveLength(1);
  expect(h.speaking.at(-1)).toEqual(["a", false]);
});

test("300 ms without packets ends speaking", () => {
  const h = harness();
  h.opus("a", Uint8Array.of(1));
  h.fireTimers();
  expect(h.speaking).toEqual([["a", true], ["a", false]]);
});

test("deafened: nothing decoded nor pushed, speaking still reported", () => {
  const h = harness({ deaf: true });
  h.opus("a", Uint8Array.of(1));
  expect(h.pushed.a).toBeUndefined();
  expect(h.decoders()).toBe(0);
  expect(h.speaking).toEqual([["a", true]]);
});

test("decode error is counted and other users keep playing", () => {
  const h = harness();
  h.opus("a", Uint8Array.of(0xee));
  h.opus("b", Uint8Array.of(2));
  expect(h.rx.stats().decodeErrors).toBe(1);
  expect(h.pushed.b).toHaveLength(1);
});

test("removing a user frees its decoder and buffer", () => {
  const h = harness();
  h.opus("a", Uint8Array.of(1));
  h.rx.removeUser("a");
  expect(h.removed).toEqual(["a"]);
  expect(h.rx.stats().usersActive).toBe(0);
  h.opus("a", Uint8Array.of(2));
  expect(h.decoders()).toBe(2);
});

test("a decoder that cannot be created is not retried on every packet and the others keep playing", () => {
  const opusListeners = new Set<(userId: string, opus: Uint8Array) => void>();
  let attempts = 0;
  const errors: unknown[] = [];
  const pushed: string[] = [];
  let clock = 0;
  createReceiver({
    session: { onOpus: (fn) => (opusListeners.add(fn), () => opusListeners.delete(fn)), onSpeaking: () => () => {} },
    mixer: { buffer: (userId) => ({ push: () => void pushed.push(userId), pop: () => null, size: 0, reset: () => {} }), remove: () => {} },
    makeDecoder: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("no pude cargar Opus");
      return { decode: (o: Uint8Array) => o };
    },
    isDeaf: () => false,
    onSpeaking: () => {},
    onDecoderError: (e) => void errors.push(e),
    now: () => clock,
    setTimer: (() => 0) as never,
    clearTimer: (() => {}) as never,
  });
  const send = (userId: string) => opusListeners.forEach((fn) => fn(userId, Uint8Array.of(1, 2, 3, 4)));
  for (let i = 0; i < 50; i += 1) send("a");
  expect(attempts).toBe(1);
  expect(errors).toHaveLength(1);
  send("b");
  expect(pushed).toContain("b");
  clock = 6_000;
  send("a");
  expect(pushed).toContain("a");
});
