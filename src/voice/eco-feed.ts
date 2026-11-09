/**
 * Feed de la llamada para eco (~/projects/eco): quién entra, quién sale y quién habla, un JSON por línea en
 * `$XDG_RUNTIME_DIR/discord-tui/voz.jsonl`. eco graba el audio del pw-cat de la llamada y con esto le pone
 * nombre a cada segmento, como hace con el Discord oficial por RPC. El archivo se trunca al entrar a un canal.
 * Solo nombres e ids públicos de Discord: nada de tokens ni contenido de mensajes.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { voiceFeedPath } from "../config/paths";
import { log } from "../log/logger";
import type { Store } from "../store/store";
import type { AppState } from "../store/types";
import { displayName } from "../ui/format";

export type FeedEventName = "JOIN" | "LEAVE" | "SPEAKING_START" | "SPEAKING_STOP";

export interface FeedEvent {
  t: number;
  evt: FeedEventName;
  user: string;
  user_id: string;
  channel: string;
  channel_id: string;
  guild: string;
  guild_id: string;
  /** Solo en el JOIN propio: quién sos, el pid de discord-tui y quiénes están en el canal. */
  self_id?: string;
  pid?: number;
  members?: { user_id: string; user: string }[];
}

interface Call {
  guildId: string;
  channelId: string;
  meId: string;
  members: Set<string>;
  speaking: Set<string>;
}

function callOf(state: AppState): Call | null {
  const v = state.voice;
  const meId = state.me?.id;
  if (!meId || v.guildId === null || v.channelId === null) return null;
  if (v.status !== "connected" && v.status !== "reconnecting") return null;
  const members = new Set<string>();
  for (const [userId, member] of Object.entries(v.states[v.guildId] ?? {})) {
    if (member.channelId === v.channelId) members.add(userId);
  }
  members.add(meId);
  const speaking = new Set(Object.keys(v.speaking).filter((id) => id !== meId));
  if (v.selfSpeaking) speaking.add(meId);
  return { guildId: v.guildId, channelId: v.channelId, meId, members, speaking };
}

function sameCall(a: Call | null, b: Call | null): boolean {
  return a !== null && b !== null && a.guildId === b.guildId && a.channelId === b.channelId && a.meId === b.meId;
}

/** Los eventos que separan dos estados (los nombres salen de `next`, que es el más nuevo). */
export function feedEvents(prev: AppState, next: AppState, t: number, pid = process.pid): FeedEvent[] {
  const before = callOf(prev);
  const after = callOf(next);
  const out: FeedEvent[] = [];

  function event(evt: FeedEventName, call: Call, userId: string): FeedEvent {
    return {
      t,
      evt,
      user: displayName(next, userId, call.guildId),
      user_id: userId,
      channel: next.channels[call.channelId]?.name ?? prev.channels[call.channelId]?.name ?? "",
      channel_id: call.channelId,
      guild: next.guilds[call.guildId]?.name ?? prev.guilds[call.guildId]?.name ?? "",
      guild_id: call.guildId,
    };
  }

  if (before !== null && !sameCall(before, after)) {
    for (const userId of before.speaking) out.push(event("SPEAKING_STOP", before, userId));
    out.push(event("LEAVE", before, before.meId));
  }
  if (after === null) return out;

  if (!sameCall(before, after)) {
    const join = event("JOIN", after, after.meId);
    join.self_id = after.meId;
    join.pid = pid;
    join.members = [...after.members].map((userId) => ({ user_id: userId, user: displayName(next, userId, after.guildId) }));
    out.push(join);
    for (const userId of after.speaking) out.push(event("SPEAKING_START", after, userId));
    return out;
  }

  const was = before as Call;
  for (const userId of after.members) if (!was.members.has(userId)) out.push(event("JOIN", after, userId));
  for (const userId of was.speaking) if (!after.speaking.has(userId)) out.push(event("SPEAKING_STOP", after, userId));
  for (const userId of after.speaking) if (!was.speaking.has(userId)) out.push(event("SPEAKING_START", after, userId));
  for (const userId of was.members) if (!after.members.has(userId)) out.push(event("LEAVE", after, userId));
  return out;
}

export type FeedWriter = (lines: string, truncate: boolean) => void;

export function fileFeedWriter(path: string = voiceFeedPath()): FeedWriter {
  let warned = false;
  return (lines, truncate) => {
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      if (truncate) writeFileSync(path, lines, { mode: 0o600 });
      else appendFileSync(path, lines, { mode: 0o600 });
    } catch (error) {
      if (warned) return;
      warned = true;
      log.warn("voice.feed", { state: "write-failed", error_name: error instanceof Error ? error.name : "unknown" });
    }
  };
}

/** Escribe el feed mirando cada cambio del store. Devuelve la función para soltarlo. */
export function attachVoiceFeed(
  store: Store,
  opts: { write?: FeedWriter; now?: () => number; pid?: number } = {},
): () => void {
  const write = opts.write ?? fileFeedWriter();
  const now = opts.now ?? (() => Date.now() / 1000);
  let prev = store.getState();
  return store.subscribe(() => {
    const next = store.getState();
    if (next === prev) return;
    const before = prev;
    prev = next;
    if (before.voice === next.voice && before.members === next.members && before.users === next.users) return;
    const events = feedEvents(before, next, now(), opts.pid);
    if (events.length === 0) return;
    const truncate = events.some((e) => e.evt === "JOIN" && e.self_id !== undefined);
    // Al entrar a un canal se trunca desde el JOIN: lo anterior (el LEAVE del canal viejo) ya no importa.
    const from = truncate ? events.findIndex((e) => e.evt === "JOIN" && e.self_id !== undefined) : 0;
    write(events.slice(from).map((e) => `${JSON.stringify(e)}\n`).join(""), truncate);
  });
}
