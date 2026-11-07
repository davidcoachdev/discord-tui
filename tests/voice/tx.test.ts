import { expect, test } from "bun:test";

import { SILENCE_FRAME } from "../../src/voice/constants";
import { createTransmitter } from "../../src/voice/tx";

function harness(opts: { gate?: "vad" | "ptt"; muted?: boolean } = {}) {
  const frameListeners = new Set<(pcm: Uint8Array) => void>();
  const capture = {
    onFrame(fn: (pcm: Uint8Array) => void) {
      frameListeners.add(fn);
      return () => frameListeners.delete(fn);
    },
  };
  let vadOpen = false;
  const vad = {
    push: () => null,
    get isOpen() {
      return vadOpen;
    },
    levelDb: -30,
    thresholdDb: -45,
  };
  const sent: Uint8Array[] = [];
  const speaking: boolean[] = [];
  const self: boolean[] = [];
  let gate = opts.gate ?? "vad";
  let muted = opts.muted ?? false;
  const tx = createTransmitter({
    capture,
    codec: { encode: (pcm) => Uint8Array.of(0xaa, pcm[0] ?? 0) },
    vad: vad as never,
    session: { sendOpus: (f) => sent.push(f), setSpeaking: (on) => speaking.push(on) },
    getGate: () => gate,
    isMuted: () => muted,
    onSelfSpeaking: (on) => self.push(on),
  });
  const frame = (n: number) => frameListeners.forEach((fn) => fn(Uint8Array.of(n)));
  return {
    tx,
    sent,
    speaking,
    self,
    frame,
    setVad: (on: boolean) => (vadOpen = on),
    setGate: (g: "vad" | "ptt") => (gate = g),
    setMuted: (m: boolean) => (muted = m),
  };
}

const isSilence = (f: Uint8Array) => f.length === 3 && f.every((b, i) => b === SILENCE_FRAME[i]);

test("vad mode: frames only while open, then 5 silence frames and Speaking 0", () => {
  const h = harness();
  h.frame(1);
  h.setVad(true);
  h.frame(2);
  h.frame(3);
  h.setVad(false);
  h.frame(4);
  h.frame(5);
  expect(h.sent.slice(0, 2).map((f) => f[1])).toEqual([2, 3]);
  expect(h.sent.slice(2).every(isSilence)).toBe(true);
  expect(h.sent).toHaveLength(7);
  expect(h.speaking).toEqual([false]);
  expect(h.self).toEqual([true, false]);
});

test("ptt mode ignores the vad and follows setPtt", () => {
  const h = harness({ gate: "ptt" });
  h.setVad(true);
  h.frame(1);
  expect(h.sent).toHaveLength(0);
  h.tx.setPtt(true);
  h.frame(2);
  h.tx.setPtt(false);
  h.frame(3);
  expect(h.sent[0]![1]).toBe(2);
  expect(h.sent.slice(1).every(isSilence)).toBe(true);
  expect(h.self).toEqual([true, false]);
});

test("muted never opens and onSelfSpeaking stays quiet", () => {
  const h = harness({ muted: true });
  h.setVad(true);
  h.tx.setPtt(true);
  h.frame(1);
  h.frame(2);
  expect(h.sent).toHaveLength(0);
  expect(h.self).toEqual([]);
});

test("muting mid-spurt closes it with silence", () => {
  const h = harness();
  h.setVad(true);
  h.frame(1);
  h.setMuted(true);
  h.frame(2);
  expect(h.sent.slice(1).every(isSilence)).toBe(true);
  expect(h.self).toEqual([true, false]);
});

test("stop closes an open spurt and ignores later frames", () => {
  const h = harness();
  h.setVad(true);
  h.frame(1);
  h.tx.stop();
  h.frame(2);
  expect(h.sent).toHaveLength(6);
  expect(h.speaking).toEqual([false]);
});
