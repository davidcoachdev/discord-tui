import { selectChannelList } from "../store/selectors";
import type { AppState } from "../store/types";

export interface SwitcherItem {
  channelId: string;
  label: string;
  unread: boolean;
  kind: "text" | "voice" | "dm" | "group_dm";
}

const MAX_ITEMS = 20;
const WORD_BREAKS = new Set([" ", "-", "_", "/", "›", "#", "@"]);

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function isWordStart(target: string, index: number): boolean {
  return index === 0 || WORD_BREAKS.has(target[index - 1]!);
}

function scoreFrom(query: string, target: string, first: number): number | null {
  let score = 0;
  let prev = -1;
  let at = first;
  for (const ch of query) {
    const index = target.indexOf(ch, at);
    if (index === -1) return null;
    score += 1;
    if (index === prev + 1 && prev !== -1) score += 5;
    if (isWordStart(target, index)) score += 8;
    if (prev !== -1) score -= Math.min(index - prev - 1, 5) * 0.2;
    prev = index;
    at = index + 1;
  }
  return score - first * 0.01;
}

/** Subsecuencia sin mayúsculas ni tildes; más puntos a contiguos e inicios de palabra. */
export function fuzzyScore(query: string, target: string): number | null {
  const q = normalize(query);
  if (q === "") return 0;
  const t = normalize(target);
  let best: number | null = null;
  for (let first = t.indexOf(q[0]!); first !== -1; first = t.indexOf(q[0]!, first + 1)) {
    const score = scoreFrom(q, t, first);
    if (score === null) break;
    if (best === null || score > best) best = score;
  }
  return best;
}

function switcherItems(s: AppState): SwitcherItem[] {
  const items: SwitcherItem[] = [];
  for (const guildId of s.guildOrder) {
    const guildName = s.guilds[guildId]?.name ?? guildId;
    for (const row of selectChannelList(s, guildId)) {
      if (row.kind === "text") items.push({ channelId: row.id, label: `${guildName} › #${row.name}`, unread: row.unread, kind: "text" });
      else if (row.kind === "voice") items.push({ channelId: row.id, label: `${guildName} › 🔊 ${row.name}`, unread: row.unread, kind: "voice" });
    }
  }
  for (const row of selectChannelList(s, "@dms")) {
    if (row.kind === "dm" || row.kind === "group_dm") items.push({ channelId: row.id, label: `@${row.name}`, unread: row.unread, kind: row.kind });
  }
  return items;
}

export function rankSwitcherItems(s: AppState, query: string): SwitcherItem[] {
  const items = switcherItems(s);
  if (query.trim() === "") {
    return [...items.filter((item) => item.unread), ...items.filter((item) => !item.unread)].slice(0, MAX_ITEMS);
  }
  return items
    .map((item) => ({ item, score: fuzzyScore(query, item.label) }))
    .filter((entry): entry is { item: SwitcherItem; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ITEMS)
    .map((entry) => entry.item);
}
