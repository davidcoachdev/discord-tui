import { describe, expect, test } from "bun:test";

import { createFramer } from "../../src/voice/pcm-framer";
import { FRAME_BYTES, sine440 } from "../helpers/pcm";

describe("createFramer", () => {
  test("emits exact 3840-byte frames and keeps the remainder", () => {
    const framer = createFramer();
    expect(framer.push(new Uint8Array(1000))).toHaveLength(0);
    const out = framer.push(new Uint8Array(7000));
    expect(out).toHaveLength(2);
    expect(out.every((frame) => frame.length === FRAME_BYTES)).toBe(true);
    expect(framer.pending()).toBe(320);
  });

  test("odd-sized chunks still align", () => {
    const framer = createFramer();
    const frames: Uint8Array[] = [];
    for (let i = 0; i < 3; i += 1) frames.push(...framer.push(new Uint8Array(1281)));
    expect(frames).toHaveLength(1);
    expect(framer.pending()).toBe(3 * 1281 - FRAME_BYTES);
  });

  test("passes a whole frame through untouched", () => {
    const framer = createFramer();
    const frame = sine440();
    const [out] = framer.push(frame);
    expect(out && [...out]).toEqual([...frame]);
    expect(framer.pending()).toBe(0);
  });

  test("accepts a custom frame size", () => {
    const framer = createFramer(4);
    expect(framer.push(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8))).toHaveLength(2);
    expect(framer.pending()).toBe(0);
  });

  test("clear() drops the remainder", () => {
    const framer = createFramer();
    framer.push(new Uint8Array(100));
    framer.clear();
    expect(framer.pending()).toBe(0);
  });
});
