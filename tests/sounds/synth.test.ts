import { describe, expect, test } from "bun:test";

import { CUES, PEAK, cueDurationMs, renderCue } from "../../src/sounds/synth";
import { sampleAt } from "../helpers/pcm";

function samples(frames: Uint8Array[]): number[] {
  const out: number[] = [];
  for (const frame of frames) for (let i = 0; i < frame.byteLength / 2; i += 1) out.push(sampleAt(frame, i));
  return out;
}

describe("synth", () => {
  for (const cue of CUES) {
    test(`${cue}: 20 ms frames, ≤ 400 ms, peak near -12 dBFS, starts and ends at ~0`, () => {
      const frames = renderCue(cue);
      expect(frames.length).toBeGreaterThan(2);
      for (const frame of frames) expect(frame.byteLength).toBe(3840);
      expect(cueDurationMs(cue)).toBeLessThanOrEqual(400);

      const s = samples(frames);
      const peak = Math.max(...s.map(Math.abs));
      expect(peak).toBeLessThanOrEqual(PEAK);
      // Ninguno es inaudible: el pico queda entre -18 y -12 dBFS.
      expect(peak).toBeGreaterThan(32767 * 10 ** (-18 / 20));
      // Sin clipping: nunca toca el techo de s16.
      expect(s.every((v) => v > -32768 && v < 32767)).toBe(true);

      // Ataque y caída suaves: lo primero y lo último casi en cero (stereo intercalado → 2 muestras por instante).
      const edge = 96; // 1 ms
      expect(Math.max(...s.slice(0, 4).map(Math.abs))).toBeLessThan(PEAK * 0.05);
      expect(Math.max(...s.slice(-edge).map(Math.abs))).toBeLessThan(PEAK * 0.05);
    });
  }

  test("left and right are identical (mono in stereo) and repeated renders are cached", () => {
    const frame = renderCue("join")[2]!;
    for (let i = 0; i < 960; i += 50) expect(sampleAt(frame, i * 2)).toBe(sampleAt(frame, i * 2 + 1));
    expect(renderCue("join")).toBe(renderCue("join"));
  });

  test("no two adjacent samples jump hard (no clicks)", () => {
    for (const cue of CUES) {
      const s = samples(renderCue(cue));
      let maxStep = 0;
      for (let i = 2; i < s.length; i += 2) maxStep = Math.max(maxStep, Math.abs(s[i]! - s[i - 2]!));
      // A 1.4 kHz como mucho, un seno a PEAK sube ~2*pi*f/48000*PEAK ≈ 0.19*PEAK por muestra.
      expect(maxStep).toBeLessThan(PEAK * 0.25);
    }
  });
});
