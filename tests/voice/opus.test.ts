import { describe, expect, test } from "bun:test";

import { createOpusCodec } from "../../src/voice/opus";
import { FRAME_BYTES, bestCorrelation, sampleAt, silence, sine440 } from "../helpers/pcm";

function rms(pcm: Uint8Array): number {
  let sum = 0;
  const count = pcm.length / 2;
  for (let i = 0; i < count; i += 1) {
    const sample = sampleAt(pcm, i);
    sum += sample * sample;
  }
  return Math.sqrt(sum / count);
}

describe("createOpusCodec", () => {
  for (const prefer of ["native", "wasm"] as const) {
    test(`opus ${prefer} reports its backend`, () => {
      const codec = createOpusCodec({ prefer });
      expect(["native", "wasm"]).toContain(codec.backend);
    });

    test(`opus ${prefer} round-trips a 440 Hz sine with the same length and shape`, () => {
      const codec = createOpusCodec({ prefer });
      const input = sine440();
      const encoded = codec.encode(input);
      // El segundo frame del decodificador todavía carga el arranque del codec.
      codec.decode(encoded);
      const out = codec.decode(encoded);
      expect(out.length).toBe(FRAME_BYTES);
      // Opus tiene delay algorítmico: se compara la forma dejando correr el desfasaje, no la fase exacta.
      expect(bestCorrelation(input, out)).toBeGreaterThan(0.7);
      expect(rms(out)).toBeGreaterThan(1000);
    });

    test(`opus ${prefer} decodes silence back to a near-silent frame`, () => {
      const codec = createOpusCodec({ prefer });
      const encoded = codec.encode(silence());
      codec.decode(encoded);
      const out = codec.decode(encoded);
      expect(rms(out)).toBeLessThan(500);
    });
  }

  test("encode+decode p99 under 5 ms per frame", () => {
    const codec = createOpusCodec();
    const pcm = sine440();
    codec.decode(codec.encode(pcm));
    const times: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      const start = performance.now();
      codec.decode(codec.encode(pcm));
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const p99 = times[Math.floor(times.length * 0.99)] ?? Infinity;
    expect(p99).toBeLessThan(5);
  });
});
