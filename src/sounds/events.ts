/**
 * Qué evento suena: se deduce mirando el estado antes y después (así cubre teclas, mouse y lo que hace Discord
 * solo, como cortarte la voz).
 */
import type { Store } from "../store/store";
import type { AppState, VoiceSlice } from "../store/types";
import type { Cue } from "./synth";

/** Sonidos de tu propia voz: entrar, salir, cortarse, mute/deafen y Go Live. */
export function ownVoiceCues(prev: VoiceSlice, next: VoiceSlice): Cue[] {
  const cues: Cue[] = [];
  if (prev.status === "joining" && next.status === "connected" && next.channelId !== null) cues.push("join");
  const left = prev.channelId !== null && next.channelId === null;
  if (left) cues.push(next.error ? "disconnect" : "leave");

  if (prev.selfDeaf !== next.selfDeaf) cues.push(next.selfDeaf ? "deafen" : "undeafen");
  else if (prev.selfMute !== next.selfMute) cues.push(next.selfMute ? "mute" : "unmute");

  const wasLive = prev.stream.status === "live";
  const isLive = next.stream.status === "live";
  if (!wasLive && isLive) cues.push("streamStart");
  // Al salir de la voz el stream se corta solo: con el sonido de salir alcanza.
  if (wasLive && !isLive && !left) cues.push("streamStop");
  return cues;
}

function peers(state: AppState): Set<string> | null {
  const v = state.voice;
  if (v.status !== "connected" || v.channelId === null || v.guildId === null) return null;
  const me = state.me?.id;
  const out = new Set<string>();
  for (const [userId, member] of Object.entries(v.states[v.guildId] ?? {})) {
    if (userId !== me && member.channelId === v.channelId) out.add(userId);
  }
  return out;
}

/**
 * Alguien entró o salió de TU canal de voz, comparando antes/después de un VOICE_STATE_UPDATE. Nada si no estás
 * conectado, si cambiaste vos de canal o si el que se movió sos vos.
 */
export function peerCue(before: AppState, after: AppState): Cue | null {
  if (before.voice.channelId !== after.voice.channelId) return null;
  const a = peers(before);
  const b = peers(after);
  if (!a || !b) return null;
  for (const userId of b) if (!a.has(userId)) return "userJoin";
  for (const userId of a) if (!b.has(userId)) return "userLeave";
  return null;
}

export function attachVoiceSounds(store: Store, play: (cue: Cue) => void): () => void {
  let prev = store.getState().voice;
  return store.subscribe(() => {
    const next = store.getState().voice;
    if (next === prev) return;
    const before = prev;
    prev = next;
    for (const cue of ownVoiceCues(before, next)) play(cue);
  });
}
