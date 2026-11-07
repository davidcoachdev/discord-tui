import { log } from "../log/logger";
import type { Store } from "../store/store";
import type { AudioCapture, AudioPlayback } from "../voice/audio-io";
import { createMixer, type Mixer } from "../voice/mixer";
import { createPtt, type Ptt, type PttKey } from "../voice/ptt";
import { createReceiver, type Receiver } from "../voice/rx";
import type { VoiceSession } from "../voice/session";
import { createTransmitter, type Transmitter } from "../voice/tx";
import type { Vad } from "../voice/vad";

export interface VoiceMedia {
  startCapture(opts?: { target?: string }): Promise<AudioCapture>;
  startPlayback(opts?: { target?: string }): Promise<AudioPlayback>;
  createCodec(): { encode(pcm: Uint8Array): Uint8Array; decode(opus: Uint8Array): Uint8Array };
  createVad(opts: { sensitivity: "auto" | number }): Vad;
}

export interface VoiceActions {
  toggleVoice(channelId: string): Promise<void>;
  leaveVoice(): Promise<void>;
  toggleMute(): void;
  toggleDeaf(): void;
  setInputMode(mode: "voice_activity" | "push_to_talk"): void;
  toggleInputMode(): void;
  pttKey(e: PttKey): void;
  /** Nivel del mic en vivo (para la barra): dBFS y umbral. */
  micLevel(): { levelDb: number; thresholdDb: number } | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "error";
}

export function createVoiceActions(deps: {
  store: Store;
  session: VoiceSession;
  media: VoiceMedia;
  kittyKeyboard?: () => boolean;
}): VoiceActions {
  const { store, session } = deps;
  let capture: AudioCapture | null = null;
  let playback: AudioPlayback | null = null;
  let tx: Transmitter | null = null;
  let rx: Receiver | null = null;
  let mixer: Mixer | null = null;
  let vad: Vad | null = null;
  let ptt: Ptt | null = null;
  let codeTimer: ReturnType<typeof setInterval> | null = null;
  let media = 0;

  const voice = () => store.getState().voice;
  const settings = () => store.getState().settings;

  function getPtt(): Ptt {
    if (ptt) return ptt;
    ptt = createPtt({ kittyKeyboard: deps.kittyKeyboard?.() ?? true });
    ptt.onChange(() => {
      tx?.setPtt(ptt!.transmitting);
      if (voice().pttWarning !== ptt!.warning) store.dispatch({ type: "voice/pttWarning", warning: ptt!.warning });
    });
    if (ptt.warning) store.dispatch({ type: "voice/pttWarning", warning: ptt.warning });
    return ptt;
  }

  async function startMedia(): Promise<void> {
    const generation = ++media;
    const s = settings();
    const codec = deps.media.createCodec();

    try {
      const out = await deps.media.startPlayback({ target: s.outputDevice ?? undefined });
      if (generation !== media) return void out.stop();
      playback = out;
      mixer = createMixer({
        playback: out,
        gainFor: (userId) => settings().userVolumes[userId] ?? 100,
      });
      mixer.setMuted(voice().selfDeaf);
      mixer.start();
      rx = createReceiver({
        session,
        mixer,
        makeDecoder: () => deps.media.createCodec(),
        isDeaf: () => voice().selfDeaf,
        onSpeaking: (userId, on) => store.dispatch({ type: "voice/speaking", userId, on }),
      });
    } catch (error) {
      store.dispatch({ type: "notice/push", key: "voice-output", level: "warn", text: errorText(error) });
    }

    try {
      const mic = await deps.media.startCapture({ target: s.inputDevice ?? undefined });
      if (generation !== media) return void mic.stop();
      capture = mic;
      vad = deps.media.createVad({ sensitivity: s.vadSensitivity });
      tx = createTransmitter({
        capture: mic,
        codec,
        vad,
        session,
        getGate: () => (settings().inputMode === "push_to_talk" ? "ptt" : "vad"),
        isMuted: () => voice().selfMute || voice().selfDeaf,
        onSelfSpeaking: (on) => store.dispatch({ type: "voice/selfSpeaking", on }),
      });
      tx.setPtt(ptt?.transmitting ?? false);
      store.dispatch({ type: "voice/micError", error: null });
    } catch (error) {
      store.dispatch({ type: "voice/micError", error: errorText(error) });
      store.dispatch({ type: "notice/push", key: "voice-mic", level: "warn", text: errorText(error) });
    }

    codeTimer = setInterval(() => {
      store.dispatch({ type: "voice/privacyCode", code: session.privacyCode() });
    }, 1_000);
    codeTimer.unref?.();
  }

  async function stopMedia(): Promise<void> {
    media += 1;
    if (codeTimer !== null) clearInterval(codeTimer);
    codeTimer = null;
    tx?.stop();
    tx = null;
    rx?.stop();
    rx = null;
    mixer?.stop();
    mixer = null;
    vad = null;
    ptt?.reset();
    const mic = capture;
    const out = playback;
    capture = null;
    playback = null;
    await Promise.allSettled([mic?.stop(), out?.stop()]);
  }

  session.onStatus((status, error) => {
    log.info("voice.ui-status", { state: status });
    if (status === "connected") {
      store.dispatch({ type: "voice/status", status });
      if (capture === null && playback === null) void startMedia();
    } else if (status === "idle" || status === "error") {
      const wasIn = voice().channelId !== null;
      void stopMedia();
      if (wasIn || status === "error") store.dispatch({ type: "voice/left", error: status === "error" ? error ?? "se cortó la voz" : null });
    } else {
      store.dispatch({ type: "voice/status", status });
    }
  });

  // Si Discord nos saca del canal (entraste desde otro dispositivo, kick) salimos también acá;
  // si un moderador nos mueve de canal, lo seguimos.
  let seenSelf = false;
  store.subscribe(() => {
    const state = store.getState();
    const v = state.voice;
    const meId = state.me?.id;
    if (v.channelId === null || v.guildId === null || !meId) {
      seenSelf = false;
      return;
    }
    const mine = v.states[v.guildId]?.[meId];
    if (mine?.channelId === v.channelId) {
      seenSelf = true;
      return;
    }
    if (!seenSelf) return;
    seenSelf = false;
    if (mine === undefined) void leaveVoice("te desconectaron del canal");
    else store.dispatch({ type: "voice/moved", channelId: mine.channelId });
  });

  async function leaveVoice(error?: string): Promise<void> {
    await stopMedia();
    await session.leave();
    store.dispatch({ type: "voice/left", error: error ?? null });
  }

  function pushFlags(selfMute: boolean, selfDeaf: boolean, muteBeforeDeaf: boolean): void {
    store.dispatch({ type: "voice/flags", selfMute, selfDeaf, muteBeforeDeaf });
    mixer?.setMuted(selfDeaf);
    if (voice().channelId !== null) session.setFlags({ selfMute, selfDeaf });
  }

  function setInputMode(mode: "voice_activity" | "push_to_talk"): void {
    store.dispatch({ type: "settings/set", patch: { inputMode: mode } });
    if (mode === "push_to_talk") getPtt();
    else {
      ptt?.reset();
      store.dispatch({ type: "voice/pttWarning", warning: null });
    }
  }

  return {
    async toggleVoice(channelId: string): Promise<void> {
      const state = store.getState();
      const channel = state.channels[channelId];
      if (!channel || channel.type !== 2 || channel.guildId === null) {
        store.dispatch({ type: "notice/push", key: "voice-not-voice", level: "info", text: "elegí un canal de voz 🔊" });
        return;
      }
      if (state.voice.channelId === channelId) {
        await leaveVoice();
        return;
      }
      if (state.voice.channelId !== null) {
        await stopMedia();
        await session.leave();
      }
      store.dispatch({ type: "voice/joining", guildId: channel.guildId, channelId });
      if (settings().inputMode === "push_to_talk") getPtt();
      try {
        await session.join(channel.guildId, channelId, { selfMute: voice().selfMute, selfDeaf: voice().selfDeaf });
      } catch (error) {
        await stopMedia();
        store.dispatch({ type: "voice/left", error: errorText(error) });
      }
    },

    leaveVoice: () => leaveVoice(),

    toggleMute(): void {
      const v = voice();
      if (v.selfDeaf) {
        // Como el oficial: desmutear estando ensordecido saca los dos.
        pushFlags(false, false, false);
        return;
      }
      pushFlags(!v.selfMute, false, v.muteBeforeDeaf);
    },

    toggleDeaf(): void {
      const v = voice();
      if (v.selfDeaf) pushFlags(v.muteBeforeDeaf, false, false);
      else pushFlags(true, true, v.selfMute);
    },

    setInputMode,

    toggleInputMode(): void {
      setInputMode(settings().inputMode === "push_to_talk" ? "voice_activity" : "push_to_talk");
    },

    pttKey(e: PttKey): void {
      if (settings().inputMode !== "push_to_talk") return;
      getPtt().onKey(e);
    },

    micLevel() {
      return vad ? { levelDb: vad.levelDb, thresholdDb: vad.thresholdDb } : null;
    },
  };
}
