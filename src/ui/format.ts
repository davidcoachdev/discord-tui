import type { AppState } from "../store/types";

/** Ancho en celdas de terminal (emojis y CJK ocupan 2). */
export function cellWidth(text: string): number {
  return Bun.stringWidth(text);
}

/** Corta a `width` celdas con `…`, sin partir emojis. */
export function truncate(text: string, width: number): string {
  const clean = text.replace(/[\r\n\t]+/g, " ");
  if (width <= 0) return "";
  if (cellWidth(clean) <= width) return clean;
  let out = "";
  let used = 0;
  for (const segment of new Intl.Segmenter().segment(clean)) {
    const w = cellWidth(segment.segment);
    if (used + w > width - 1) break;
    out += segment.segment;
    used += w;
  }
  return `${out}…`;
}

/** Rellena con espacios hasta `width` celdas (corta si se pasa). */
export function fit(text: string, width: number): string {
  const cut = truncate(text, width);
  return cut + " ".repeat(Math.max(0, width - cellWidth(cut)));
}

export function displayName(state: AppState, userId: string, guildId: string | null): string {
  const nick = guildId !== null ? state.members[guildId]?.[userId]?.nick : null;
  const user = state.users[userId];
  return nick ?? user?.globalName ?? user?.username ?? "alguien";
}

/** El color del rol más alto con color, como el cliente oficial. */
export function memberColor(state: AppState, userId: string, guildId: string | null): number {
  if (guildId === null) return 0;
  const member = state.members[guildId]?.[userId];
  const roles = state.guilds[guildId]?.roles;
  if (!member || !roles) return 0;
  let best: { position: number; color: number } | null = null;
  for (const roleId of member.roles) {
    const role = roles.find((candidate) => candidate.id === roleId);
    if (role && role.color !== 0 && (best === null || role.position > best.position)) {
      best = { position: role.position, color: role.color };
    }
  }
  return best?.color ?? 0;
}

export function hashIndex(id: string, size: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return size === 0 ? 0 : hash % size;
}

export function clockTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toTimeString().slice(0, 5);
}

const DAY_MS = 86_400_000;

export function dayLabel(timestamp: string, now: Date = new Date()): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const startOf = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(date)) / DAY_MS);
  if (diff === 0) return "hoy";
  if (diff === 1) return "ayer";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function sameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

export function typingText(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} está escribiendo…`;
  if (names.length === 2) return `${names[0]} y ${names[1]} están escribiendo…`;
  return "varias personas están escribiendo…";
}
