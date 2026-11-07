import { describe, expect, test } from "bun:test";

import { createJitterBuffer } from "../../src/voice/jitter";
import { pcmOf, sampleAt } from "../helpers/pcm";

describe("createJitterBuffer", () => {
  test("null until 3 frames, then FIFO", () => {
    const jb = createJitterBuffer();
    jb.push(pcmOf(1));
    expect(jb.pop()).toBeNull();
    jb.push(pcmOf(2));
    expect(jb.pop()).toBeNull();
    jb.push(pcmOf(3));
    expect(jb.size).toBe(3);
    expect(sampleAt(jb.pop()!, 0)).toBe(1);
    expect(sampleAt(jb.pop()!, 0)).toBe(2);
    expect(sampleAt(jb.pop()!, 0)).toBe(3);
    expect(jb.size).toBe(0);
  });

  test("drained buffer prebuffers again instead of repeating", () => {
    const jb = createJitterBuffer();
    for (let i = 1; i <= 3; i += 1) jb.push(pcmOf(i));
    jb.pop();
    jb.pop();
    jb.pop();
    expect(jb.pop()).toBeNull();
    jb.push(pcmOf(4));
    expect(jb.pop()).toBeNull();
    jb.push(pcmOf(5));
    jb.push(pcmOf(6));
    expect(sampleAt(jb.pop()!, 0)).toBe(4);
  });

  test("keeps playing while frames remain after prebuffer", () => {
    const jb = createJitterBuffer({ prebufferFrames: 2 });
    jb.push(pcmOf(1));
    jb.push(pcmOf(2));
    expect(sampleAt(jb.pop()!, 0)).toBe(1);
    jb.push(pcmOf(3));
    expect(sampleAt(jb.pop()!, 0)).toBe(2);
    expect(sampleAt(jb.pop()!, 0)).toBe(3);
  });

  test("overflow drops the oldest", () => {
    const jb = createJitterBuffer({ maxFrames: 4 });
    for (let i = 1; i <= 6; i += 1) jb.push(pcmOf(i));
    expect(jb.size).toBe(4);
    expect(sampleAt(jb.pop()!, 0)).toBe(3);
  });

  test("reset empties and requires prebuffer again", () => {
    const jb = createJitterBuffer();
    for (let i = 1; i <= 3; i += 1) jb.push(pcmOf(i));
    jb.reset();
    expect(jb.size).toBe(0);
    jb.push(pcmOf(7));
    expect(jb.pop()).toBeNull();
  });
});
