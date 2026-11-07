import { SILENCE_FRAME } from "./constants";
import type { Mixer } from "./mixer";
import type { VoiceSession } from "./session";

export interface Receiver {
  stats(): { packets: number; decodeErrors: number; usersActive: number };
  removeUser(userId: string): void;
  stop(): void;
}

function isSilence(opus: Uint8Array): boolean {
  return (
    opus.byteLength === SILENCE_FRAME.byteLength &&
    opus[0] === SILENCE_FRAME[0] &&
    opus[1] === SILENCE_FRAME[1] &&
    opus[2] === SILENCE_FRAME[2]
  );
}

const SILENCE_END = 5;
const SPEAKING_TIMEOUT_MS = 300;

/**
 * Opus de cada participante → un decoder por usuario → jitter buffer del mixer.
 * Los frames de silencio no se decodifican; 5 seguidos o 300 ms sin paquetes = dejó de hablar.
 * Ensordecido: no se decodifica ni se reproduce, pero los indicadores siguen.
 */
export function createReceiver(deps: {
  session: Pick<VoiceSession, "onOpus" | "onSpeaking">;
  mixer: Pick<Mixer, "buffer" | "remove">;
  makeDecoder: () => { decode(opus: Uint8Array): Uint8Array };
  isDeaf: () => boolean;
  onSpeaking(userId: string, on: boolean): void;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}): Receiver {
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const decoders = new Map<string, { decode(opus: Uint8Array): Uint8Array }>();
  const silenceRun = new Map<string, number>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const speaking = new Set<string>();
  let packets = 0;
  let decodeErrors = 0;

  function setSpeaking(userId: string, on: boolean): void {
    if (on === speaking.has(userId)) return;
    if (on) speaking.add(userId);
    else speaking.delete(userId);
    deps.onSpeaking(userId, on);
  }

  function armTimeout(userId: string): void {
    const previous = timers.get(userId);
    if (previous !== undefined) clearTimer(previous);
    timers.set(
      userId,
      setTimer(() => {
        timers.delete(userId);
        setSpeaking(userId, false);
      }, SPEAKING_TIMEOUT_MS),
    );
  }

  const offOpus = deps.session.onOpus((userId, opus) => {
    packets += 1;
    if (isSilence(opus)) {
      const run = (silenceRun.get(userId) ?? 0) + 1;
      silenceRun.set(userId, run);
      if (run >= SILENCE_END) setSpeaking(userId, false);
      return;
    }
    silenceRun.set(userId, 0);
    setSpeaking(userId, true);
    armTimeout(userId);
    if (deps.isDeaf()) return;

    let decoder = decoders.get(userId);
    if (!decoder) {
      decoder = deps.makeDecoder();
      decoders.set(userId, decoder);
    }
    try {
      deps.mixer.buffer(userId).push(decoder.decode(opus));
    } catch {
      decodeErrors += 1;
    }
  });

  const offSpeaking = deps.session.onSpeaking((userId, on) => {
    if (on) {
      setSpeaking(userId, true);
      armTimeout(userId);
    } else setSpeaking(userId, false);
  });

  function removeUser(userId: string): void {
    decoders.delete(userId);
    silenceRun.delete(userId);
    const timer = timers.get(userId);
    if (timer !== undefined) clearTimer(timer);
    timers.delete(userId);
    deps.mixer.remove(userId);
    setSpeaking(userId, false);
  }

  return {
    stats() {
      return { packets, decodeErrors, usersActive: decoders.size };
    },
    removeUser,
    stop(): void {
      offOpus();
      offSpeaking();
      for (const userId of [...decoders.keys(), ...speaking]) removeUser(userId);
      for (const timer of timers.values()) clearTimer(timer);
      timers.clear();
    },
  };
}
