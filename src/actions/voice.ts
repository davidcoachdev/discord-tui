import { log } from "../log/logger";
import type { GoLive } from "../golive/golive";
import type { Monitor } from "../golive/capture";
import type { Store } from "../store/store";
import type { AudioCapture, AudioPlayback } from "../voice/audio-io";
import { createMixer, type Mixer } from "../voice/mixer";
import { createPtt, type Ptt, type PttKey } from "../voice/ptt";
import { createReceiver, type Receiver } from "../voice/rx";
import type { VoiceSession } from "../voice/session";
import { createVoiceStats } from "../voice/stats";
import { createTransmitter, type Transmitter } from "../voice/tx";
import type { Vad } from "../voice/vad";

export interface VoiceMedia {
  startCapture(opts?: { target?: string }): Promise<AudioCapture>;
  startPlayback(opts?: { target?: string }): Promise<AudioPlayback>;
  createCodec(): { encode(pcm: Uint8Array): Uint8Array; decode(opus: Uint8Array): Uint8Array; destroy?(): void };
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
  /** Go Live: transmitir un monitor (por defecto el de settings). Solo estando en un canal de voz. */
  startStream?(monitor?: string | null): Promise<void>;
  stopStream?(): Promise<void>;
  toggleStream?(): Promise<void>;
  /** Monitores que se pueden transmitir (Hyprland; si no, uno: el predeterminado). */
  listMonitors?(): Promise<Monitor[]>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "error";
}

export function createVoiceActions(deps: {
  store: Store;
  session: VoiceSession;
  media: VoiceMedia;
  kittyKeyboard?: () => boolean;
  /** Go Live atado a esta voz (src/golive). */
  stream?: GoLive;
  /**
   * Renovación de la salida para el desfase de relojes: el reloj de la PC (que marca el ritmo del mixer) y el
   * de la placa de audio se separan ~50–100 ppm, así que en una llamada larga el colchón de pw-cat se agota
   * (chasquidos) o crece (más delay). Cada `minUptimeMs`, en un silencio de `quietMs`, se abre un pw-cat nuevo.
   */
  refresh?: { checkMs?: number; minUptimeMs?: number; quietMs?: number; now?: () => number };
}): VoiceActions {
  const { store, session } = deps;
  let capture: AudioCapture | null = null;
  let playback: AudioPlayback | null = null;
  let tx: Transmitter | null = null;
  let rx: Receiver | null = null;
  let mixer: Mixer | null = null;
  let vad: Vad | null = null;
  let txCodec: { destroy?(): void } | null = null;
  let ptt: Ptt | null = null;
  let codeTimer: ReturnType<typeof setInterval> | null = null;
  let stats: { stop(): void } | null = null;
  let mediaStarted = false;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let playbackSince = 0;
  let refreshing = false;
  const clock = deps.refresh?.now ?? Date.now;
  let queue: Promise<void> = Promise.resolve();
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

  async function refreshPlayback(generation: number): Promise<void> {
    if (refreshing || !mixer || !playback) return;
    if (clock() - playbackSince < (deps.refresh?.minUptimeMs ?? 5 * 60_000)) return;
    if (mixer.idleMs() < (deps.refresh?.quietMs ?? 2_000)) return;
    refreshing = true;
    try {
      const fresh = await deps.media.startPlayback({ target: settings().outputDevice ?? undefined });
      if (generation !== media || !mixer) {
        await fresh.stop();
        return;
      }
      const old = playback;
      playback = fresh;
      mixer.setPlayback(fresh);
      playbackSince = clock();
      log.info("voice.output", { state: "refreshed" });
      await old?.stop();
    } catch (error) {
      log.warn("voice.output", { state: "refresh-failed", error_name: error instanceof Error ? error.name : "unknown" });
      playbackSince = clock();
    } finally {
      refreshing = false;
    }
  }

  function clearTimers(): void {
    if (refreshTimer !== null) clearInterval(refreshTimer);
    refreshTimer = null;
    if (codeTimer !== null) clearInterval(codeTimer);
    codeTimer = null;
    stats?.stop();
    stats = null;
  }

  async function startMedia(): Promise<void> {
    const generation = ++media;
    clearTimers();
    const s = settings();
    const codec = deps.media.createCodec();
    txCodec = codec;

    try {
      const out = await deps.media.startPlayback({ target: s.outputDevice ?? undefined });
      if (generation !== media) return void out.stop();
      playback = out;
      mixer = createMixer({
        playback: out,
        continuous: true,
        prerollFrames: 5,
        gainFor: (userId) => settings().userVolumes[userId] ?? 100,
      });
      mixer.setMuted(voice().selfDeaf);
      mixer.start();
      playbackSince = clock();
      rx = createReceiver({
        session,
        mixer,
        makeDecoder: () => deps.media.createCodec(),
        onDecoderError: (error) =>
          log.error("voice.decoder-failed", { error_name: error instanceof Error ? error.name : "unknown", msg: error instanceof Error ? error.message.slice(0, 160) : "" }),
        isDeaf: () => voice().selfDeaf,
        onSpeaking: (userId, on) => store.dispatch({ type: "voice/speaking", userId, on }),
      });
      log.info("voice.output", { state: "started", mode: s.outputDevice ? "device" : "default" });
    } catch (error) {
      log.warn("voice.output", { state: "failed", error_name: error instanceof Error ? error.name : "unknown" });
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
      log.info("voice.mic", { state: "started", mode: s.inputMode });
    } catch (error) {
      log.warn("voice.mic", { state: "failed", error_name: error instanceof Error ? error.name : "unknown" });
      store.dispatch({ type: "voice/micError", error: errorText(error) });
      store.dispatch({ type: "notice/push", key: "voice-mic", level: "warn", text: errorText(error) });
    }

    stats = createVoiceStats({
      log,
      read: () => ({ ...(rx?.stats() ?? { packets: 0, decodeErrors: 0 }), state: voice().status }),
    });
    refreshTimer = setInterval(() => void refreshPlayback(generation), deps.refresh?.checkMs ?? 10_000);
    refreshTimer.unref?.();
    codeTimer = setInterval(() => {
      store.dispatch({ type: "voice/privacyCode", code: session.privacyCode() });
    }, 1_000);
    codeTimer.unref?.();
  }

  async function stopMedia(): Promise<void> {
    media += 1;
    mediaStarted = false;
    clearTimers();
    tx?.stop();
    tx = null;
    rx?.stop();
    rx = null;
    mixer?.stop();
    mixer = null;
    vad = null;
    txCodec?.destroy?.();
    txCodec = null;
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
      if (!mediaStarted) {
        mediaStarted = true;
        void startMedia();
      }
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
    await deps.stream?.stop();
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

  /** Entrar, salir y cambiar de canal van en fila: dos `v` seguidos no se pisan. */
  function serial(job: () => Promise<void>): Promise<void> {
    const next = queue.then(job, job);
    queue = next.catch(() => {});
    return next;
  }

  async function toggleVoiceNow(channelId: string): Promise<void> {
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
        await deps.stream?.stop();
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
  }

  return {
    toggleVoice: (channelId: string) => {
      // Un `v` mientras todavía está conectando corta ese intento en vez de esperar el timeout.
      const status = voice().status;
      if (status === "joining" || status === "reconnecting") void session.leave();
      return serial(() => toggleVoiceNow(channelId));
    },

    leaveVoice: () => serial(() => leaveVoice()),

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

    ...(deps.stream
      ? {
          startStream: (monitor?: string | null) => deps.stream!.start(monitor),
          stopStream: () => deps.stream!.stop(),
          toggleStream: () => deps.stream!.toggle(),
          listMonitors: () => deps.stream!.listMonitors(),
        }
      : {}),
  };
}
