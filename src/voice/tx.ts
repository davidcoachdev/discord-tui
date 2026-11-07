import type { AudioCapture } from "./audio-io";
import { SILENCE_FRAME } from "./constants";
import type { VoiceSession } from "./session";
import type { Vad } from "./vad";

export interface Transmitter {
  setPtt(on: boolean): void;
  readonly open: boolean;
  stop(): void;
}

const SILENCE_FRAMES_ON_CLOSE = 5;

/**
 * Micrófono → compuerta (VAD o PTT, nunca con mute) → Opus → voz.
 * Al cerrar la compuerta manda los 5 frames de silencio y Speaking 0 (spec 6.6).
 */
export function createTransmitter(deps: {
  capture: Pick<AudioCapture, "onFrame">;
  codec: { encode(pcm: Uint8Array): Uint8Array };
  vad: Pick<Vad, "push" | "isOpen" | "levelDb" | "thresholdDb">;
  session: Pick<VoiceSession, "sendOpus" | "setSpeaking">;
  getGate: () => "vad" | "ptt";
  isMuted: () => boolean;
  onSelfSpeaking(on: boolean): void;
  onLevel?(levelDb: number, thresholdDb: number): void;
}): Transmitter {
  let ptt = false;
  let open = false;
  let stopped = false;

  function close(): void {
    if (!open) return;
    open = false;
    for (let i = 0; i < SILENCE_FRAMES_ON_CLOSE; i += 1) deps.session.sendOpus(SILENCE_FRAME);
    deps.session.setSpeaking(false);
    deps.onSelfSpeaking(false);
  }

  const off = deps.capture.onFrame((pcm) => {
    if (stopped) return;
    deps.vad.push(pcm);
    deps.onLevel?.(deps.vad.levelDb, deps.vad.thresholdDb);
    const wantOpen = !deps.isMuted() && (deps.getGate() === "vad" ? deps.vad.isOpen : ptt);
    if (!wantOpen) {
      close();
      return;
    }
    if (!open) {
      open = true;
      deps.onSelfSpeaking(true);
    }
    deps.session.sendOpus(deps.codec.encode(pcm));
  });

  return {
    setPtt(on: boolean): void {
      ptt = on;
    },
    get open(): boolean {
      return open;
    },
    stop(): void {
      if (stopped) return;
      close();
      stopped = true;
      off();
    },
  };
}
