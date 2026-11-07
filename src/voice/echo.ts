import type { AudioCapture, AudioPlayback } from "./audio-io";
import type { OpusCodec } from "./opus";
import type { Vad } from "./vad";

export interface EchoStats {
  frames: number;
  dropped: number;
  p99ProcessingMs: number;
}

export interface Echo {
  stop(): Promise<void>;
  stats(): EchoStats;
}

export function createEcho(deps: {
  capture: AudioCapture;
  playback: AudioPlayback;
  codec: OpusCodec;
  vad: Vad | (() => Vad);
  gate?: "vad" | "always" | (() => "vad" | "always");
}): Echo {
  const gateSetting = deps.gate ?? "vad";
  const gate = (): "vad" | "always" => (typeof gateSetting === "function" ? gateSetting() : gateSetting);
  const vad = (): Vad => (typeof deps.vad === "function" ? deps.vad() : deps.vad);
  let frames = 0;
  const durations: number[] = [];

  const off = deps.capture.onFrame((pcm) => {
    const start = performance.now();
    vad().push(pcm);
    const shouldPlay = gate() === "always" || vad().isOpen;
    if (shouldPlay) {
      const encoded = deps.codec.encode(pcm);
      const decoded = deps.codec.decode(encoded);
      deps.playback.write(decoded);
    }
    frames += 1;
    durations.push(performance.now() - start);
  });

  return {
    async stop(): Promise<void> {
      off();
      await deps.capture.stop();
      await deps.playback.stop();
    },
    stats(): EchoStats {
      const sorted = [...durations].sort((a, b) => a - b);
      const p99Index = Math.floor(sorted.length * 0.99);
      return {
        frames,
        dropped: deps.playback.dropped(),
        p99ProcessingMs: sorted[Math.min(sorted.length - 1, p99Index)] ?? 0,
      };
    },
  };
}
