import { compareSnowflakes } from "../util/snowflake";
import type { AppState, UnreadMarker } from "./types";

/**
 * La posición de lectura del canal en el momento de abrirlo (antes de que el ack la mueva),
 * o null si no hay nada sin leer. Sin read state no hay divisor: no sabemos desde dónde.
 */
export function snapshotUnread(state: AppState, channelId: string): UnreadMarker | null {
  const lastRead = state.readState[channelId]?.lastAckedId ?? null;
  if (lastRead === null) return null;
  const fromChannel = state.channels[channelId]?.lastMessageId ?? null;
  const fromSlice = state.messages[channelId]?.ids.at(-1) ?? null;
  const newest =
    fromChannel === null ? fromSlice : fromSlice === null || compareSnowflakes(fromChannel, fromSlice) >= 0 ? fromChannel : fromSlice;
  if (newest === null || compareSnowflakes(newest, lastRead) <= 0) return null;
  return { channelId, afterId: lastRead };
}

export interface UnreadView {
  /** El primer mensaje cargado sin leer (de otro), donde va el divisor; null si no está cargado o no hay. */
  firstUnreadId: string | null;
  /** Mensajes sin leer de otros que están cargados. */
  count: number;
  /** Hay sin leer más viejos que el mensaje más viejo cargado. */
  missing: boolean;
  /** Id del último leído al abrir (para la hora de la barra). */
  afterId: string | null;
}

const NONE: UnreadView = { firstUnreadId: null, count: 0, missing: false, afterId: null };

export function selectUnreadView(state: AppState, channelId: string | null): UnreadView {
  const marker = state.ui.unreadMarker;
  if (channelId === null || marker === null || marker.channelId !== channelId) return NONE;
  const slice = state.messages[channelId];
  if (!slice) return NONE;
  const me = state.me?.id ?? null;
  let firstUnreadId: string | null = null;
  let count = 0;
  for (const id of slice.ids) {
    if (compareSnowflakes(id, marker.afterId) <= 0) continue;
    const authorId = (slice.byId[id] as { author?: { id?: string } } | undefined)?.author?.id;
    if (authorId === me) continue;
    count += 1;
    firstUnreadId ??= id;
  }
  const oldest = slice.ids[0];
  const missing = count > 0 && slice.hasMoreBefore && oldest !== undefined && compareSnowflakes(oldest, marker.afterId) > 0;
  return { firstUnreadId: missing ? null : firstUnreadId, count, missing, afterId: marker.afterId };
}

/**
 * Desde cuándo, para la barra: " desde las HH:MM" si es de hoy, si no " desde el DD/MM HH:MM" (hora local
 * del snowflake). Un id sin fecha (como "0", lo que queda en un canal nunca leído) no dice nada.
 */
export function unreadSince(id: string, now: Date = new Date()): string {
  const offset = BigInt(id) >> 22n;
  if (offset === 0n) return "";
  const date = new Date(Number(offset + 1420070400000n));
  const pad = (n: number): string => String(n).padStart(2, "0");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.toDateString() === now.toDateString()) return ` desde las ${time}`;
  return ` desde el ${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${time}`;
}
