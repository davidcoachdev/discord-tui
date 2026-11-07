import type { AppState } from "../store/types";
import { fuzzyScore } from "./fuzzy";

export interface PickedMention {
  start: number;
  end: number;
  userId: string;
}

export interface MentionCandidate {
  userId: string;
  label: string;
  secondary: string | null;
}

const MAX_CANDIDATES = 8;

/** `@` + caracteres de palabra justo antes del cursor, con el `@` al inicio o tras un espacio. */
export function mentionQueryAt(text: string, cursor: number): { start: number; query: string } | null {
  const m = /(^|\s)@([\p{L}\p{N}_.-]*)$/u.exec(text.slice(0, cursor));
  if (!m) return null;
  return { start: m.index + m[1]!.length, query: m[2]! };
}

export function mentionCandidates(s: AppState, channelId: string, query: string): MentionCandidate[] {
  const guildId = s.channels[channelId]?.guildId ?? null;
  const members = guildId !== null ? s.members[guildId] ?? {} : {};
  const slice = s.messages[channelId];

  // Autores recientes primero (último mensaje primero), después los miembros cargados.
  const authorIds = slice
    ? [...slice.ids].reverse().map((id) => slice.byId[id]?.author?.id).filter((id): id is string => id !== undefined)
    : [];
  const ids = [...new Set([...authorIds, ...Object.keys(members)])].filter((id) => id !== s.me?.id);

  const ranked: { candidate: MentionCandidate; score: number }[] = [];
  for (const userId of ids) {
    const user = s.users[userId];
    if (!user) continue;
    const label = members[userId]?.nick ?? user.globalName ?? user.username;
    const scores = [fuzzyScore(query, label), fuzzyScore(query, user.username)].filter((n): n is number => n !== null);
    if (scores.length === 0) continue;
    ranked.push({
      candidate: { userId, label, secondary: user.username !== label ? user.username : null },
      score: Math.max(...scores),
    });
  }
  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map((entry) => entry.candidate);
}

/** Reemplaza `@query` (de queryStart a cursor) por `@label ` y registra el rango de `@label`. */
export function applyPick(
  text: string,
  queryStart: number,
  cursor: number,
  label: string,
  userId: string,
  mentions: PickedMention[],
): { text: string; cursor: number; mentions: PickedMention[] } {
  const inserted = `@${label} `;
  const delta = inserted.length - (cursor - queryStart);
  const shifted = mentions
    .filter((m) => m.end <= queryStart || m.start >= cursor)
    .map((m) => (m.start >= cursor ? { ...m, start: m.start + delta, end: m.end + delta } : m));
  const picked: PickedMention = { start: queryStart, end: queryStart + label.length + 1, userId };
  return {
    text: text.slice(0, queryStart) + inserted + text.slice(cursor),
    cursor: queryStart + inserted.length,
    mentions: [...shifted, picked].sort((a, b) => a.start - b.start),
  };
}

/**
 * Ajusta los rangos tras editar en `editAt`: delta > 0 inserta delta caracteres ahí,
 * delta < 0 borra [editAt, editAt - delta). Las menciones que la edición toca se descartan.
 */
export function shiftMentions(mentions: PickedMention[], editAt: number, delta: number): PickedMention[] {
  if (delta === 0) return mentions;
  const editEnd = delta > 0 ? editAt : editAt - delta;
  return mentions
    .filter((m) => (delta > 0 ? !(editAt > m.start && editAt < m.end) : !(editAt < m.end && editEnd > m.start)))
    .map((m) => (m.start >= editEnd ? { ...m, start: m.start + delta, end: m.end + delta } : m));
}

/** Cambia cada rango elegido por `<@id>`; el `@algo` escrito a mano queda como texto. */
export function serializeComposer(text: string, mentions: PickedMention[]): string {
  let out = "";
  let at = 0;
  for (const m of [...mentions].sort((a, b) => a.start - b.start)) {
    if (m.start < at || m.end > text.length || text[m.start] !== "@") continue;
    out += text.slice(at, m.start) + `<@${m.userId}>`;
    at = m.end;
  }
  return out + text.slice(at);
}
