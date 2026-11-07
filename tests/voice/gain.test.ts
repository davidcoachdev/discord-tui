import { describe, expect, test } from "bun:test";

import { applyGain } from "../../src/voice/gain";
import { pcmOf, sampleAt } from "../helpers/pcm";

describe("applyGain", () => {
  test("200% saturates at the positive ceiling", () => {
    expect(sampleAt(applyGain(pcmOf(20000), 200), 0)).toBe(32767);
  });

  test("50% halves the sample", () => {
    expect(sampleAt(applyGain(pcmOf(20000), 50), 0)).toBe(10000);
  });

  test("200% saturates at the negative floor", () => {
    expect(sampleAt(applyGain(pcmOf(-20000), 200), 0)).toBe(-32768);
  });

  test("100% returns an equivalent buffer", () => {
    const input = pcmOf(1234);
    const out = applyGain(input, 100);
    expect([...out]).toEqual([...input]);
  });

  test("0% is silence", () => {
    expect(sampleAt(applyGain(pcmOf(20000), 0), 0)).toBe(0);
  });
});
