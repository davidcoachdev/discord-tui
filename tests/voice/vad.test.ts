import { describe, expect, test } from "bun:test";

import { createVad, rmsDbfs } from "../../src/voice/vad";
import { loud, quiet, sine, silence, square } from "../helpers/pcm";

describe("rmsDbfs", () => {
  test("silence is -96 dBFS", () => {
    expect(rmsDbfs(silence())).toBe(-96);
  });

  test("a full-scale square wave is ~0 dBFS", () => {
    expect(rmsDbfs(square(32767))).toBeCloseTo(0, 1);
  });

  test("a half-scale sine is about -9.03 dBFS", () => {
    expect(rmsDbfs(sine(0.5))).toBeCloseTo(-9.03, 1);
  });
});

describe("createVad", () => {
  test("opens on the 2nd loud frame, not the 1st", () => {
    const vad = createVad({ sensitivity: -40 });
    expect(vad.push(loud())).toBeNull();
    expect(vad.push(loud())).toBe("open");
    expect(vad.isOpen).toBe(true);
  });

  test("stays open through 280 ms of silence and closes at 300 ms", () => {
    const vad = createVad({ sensitivity: -40 });
    vad.push(loud());
    vad.push(loud());
    for (let i = 0; i < 14; i += 1) {
      expect(vad.push(silence())).toBeNull();
    }
    expect(vad.isOpen).toBe(true);
    expect(vad.push(silence())).toBe("close");
    expect(vad.isOpen).toBe(false);
  });

  test("a 200 ms pause inside a word does not close", () => {
    const vad = createVad({ sensitivity: -40 });
    vad.push(loud());
    vad.push(loud());
    for (let i = 0; i < 10; i += 1) vad.push(silence());
    expect(vad.isOpen).toBe(true);
    vad.push(loud());
    expect(vad.isOpen).toBe(true);
    for (let i = 0; i < 14; i += 1) expect(vad.push(silence())).toBeNull();
    expect(vad.isOpen).toBe(true);
  });

  test("auto threshold follows a -50 dBFS noise floor: -45 does not open, -30 opens", () => {
    const vad = createVad({ sensitivity: "auto" });
    for (let i = 0; i < 150; i += 1) vad.push(quiet(-50));
    expect(vad.isOpen).toBe(false);
    const notOpen1 = vad.push(quiet(-45));
    const notOpen2 = vad.push(quiet(-45));
    expect(notOpen1).toBeNull();
    expect(notOpen2).toBeNull();
    expect(vad.isOpen).toBe(false);

    expect(vad.push(quiet(-30))).toBeNull();
    expect(vad.push(quiet(-30))).toBe("open");
  });

  test("threshold is clamped to [-60, -20]", () => {
    const quietVad = createVad({ sensitivity: "auto" });
    for (let i = 0; i < 150; i += 1) quietVad.push(silence());
    expect(quietVad.thresholdDb).toBeGreaterThanOrEqual(-60);

    const loudVad = createVad({ sensitivity: "auto" });
    for (let i = 0; i < 150; i += 1) loudVad.push(quiet(-5));
    expect(loudVad.thresholdDb).toBeLessThanOrEqual(-20);
  });

  test("manual sensitivity sets a fixed threshold", () => {
    const vad = createVad({ sensitivity: -35 });
    expect(vad.thresholdDb).toBe(-35);
  });
});
