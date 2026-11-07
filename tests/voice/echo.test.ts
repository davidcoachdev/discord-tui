import { describe, expect, test } from "bun:test";

import { createEcho } from "../../src/voice/echo";
import { createOpusCodec } from "../../src/voice/opus";
import { createVad } from "../../src/voice/vad";
import { FRAME_BYTES, loud, silence } from "../helpers/pcm";

function fakeCapture() {
  const listeners = new Set<(pcm: Uint8Array) => void>();
  return {
    onFrame(fn: (pcm: Uint8Array) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async stop() {},
    emit(pcm: Uint8Array) {
      for (const fn of listeners) fn(pcm);
    },
  };
}

function fakePlayback() {
  const frames: Uint8Array[] = [];
  return {
    write(pcm: Uint8Array) {
      frames.push(pcm);
    },
    async stop() {},
    dropped: () => 0,
    frames,
  };
}

describe("createEcho", () => {
  test("pipes captured frames through opus into playback", async () => {
    const capture = fakeCapture();
    const playback = fakePlayback();
    const codec = createOpusCodec();
    const vad = createVad();
    const echo = createEcho({ capture: capture as any, playback: playback as any, codec, vad, gate: "always" });

    const captured = [loud(), loud(), loud()];
    for (const frame of captured) capture.emit(frame);

    expect(playback.frames).toHaveLength(captured.length);
    expect(playback.frames.every((f) => f.length === FRAME_BYTES)).toBe(true);
    await echo.stop();
  });

  test("vad gate only plays while open", async () => {
    const capture = fakeCapture();
    const playback = fakePlayback();
    const codec = createOpusCodec();
    const vad = createVad({ sensitivity: -40 });
    const echo = createEcho({ capture: capture as any, playback: playback as any, codec, vad, gate: "vad" });

    capture.emit(silence());
    expect(playback.frames).toHaveLength(0);
    capture.emit(loud());
    capture.emit(loud()); // abre en el 2do frame fuerte
    expect(playback.frames).toHaveLength(1);
    await echo.stop();
  });

  test("p99 processing per frame is under 5 ms", async () => {
    const capture = fakeCapture();
    const playback = fakePlayback();
    const codec = createOpusCodec();
    const vad = createVad();
    const echo = createEcho({ capture: capture as any, playback: playback as any, codec, vad, gate: "always" });

    for (let i = 0; i < 50; i += 1) capture.emit(loud());
    const stats = echo.stats();
    expect(stats.p99ProcessingMs).toBeLessThan(5);
    expect(stats.frames).toBe(50);
    await echo.stop();
  });
});
