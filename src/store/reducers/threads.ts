import type { AppState, ChannelState } from "../types";
import { applyChannelDelete } from "./channels";

/** 10 hilo de anuncios, 11 hilo público, 12 hilo privado. */
export const THREAD_TYPES = new Set([10, 11, 12]);

export function isThreadPayload(d: any): boolean {
  return typeof d?.type === "number" && THREAD_TYPES.has(d.type);
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Hilo crudo (READY, THREAD_*, búsqueda de posts) → ChannelState; null si no tiene lo mínimo. */
export function toThread(raw: any, guildId: string | null, previous?: ChannelState): ChannelState | null {
  if (typeof raw?.id !== "string" || !isThreadPayload(raw)) return null;
  const guild = typeof raw.guild_id === "string" ? raw.guild_id : guildId ?? previous?.guildId ?? null;
  const parentId = typeof raw.parent_id === "string" ? raw.parent_id : previous?.parentId ?? null;
  if (guild === null || parentId === null) return null;
  const meta = raw.thread_metadata !== null && typeof raw.thread_metadata === "object" ? raw.thread_metadata : {};
  const before = previous?.thread;
  return {
    id: raw.id,
    guildId: guild,
    name: typeof raw.name === "string" ? raw.name : previous?.name ?? raw.id,
    type: raw.type,
    position: 0,
    parentId,
    permissionOverwrites: [],
    // THREAD_UPDATE no trae last_message_id: se conserva el que había.
    lastMessageId: typeof raw.last_message_id === "string" ? raw.last_message_id : previous?.lastMessageId ?? null,
    thread: {
      archived: typeof meta.archived === "boolean" ? meta.archived : before?.archived ?? false,
      locked: typeof meta.locked === "boolean" ? meta.locked : before?.locked ?? false,
      ownerId: typeof raw.owner_id === "string" ? raw.owner_id : before?.ownerId ?? null,
      messageCount: count(raw.message_count) ?? before?.messageCount ?? null,
      memberCount: count(raw.member_count) ?? before?.memberCount ?? null,
    },
  };
}

/** THREAD_CREATE, THREAD_UPDATE y CHANNEL_CREATE/UPDATE con tipo de hilo. */
export function applyThreadUpsert(state: AppState, d: any): AppState {
  const thread = toThread(d, null, typeof d?.id === "string" ? state.channels[d.id] : undefined);
  if (!thread) return state;
  return { ...state, channels: { ...state.channels, [thread.id]: thread } };
}

/** THREAD_DELETE: solo trae id, guild_id, parent_id y type. */
export function applyThreadDelete(state: AppState, d: any): AppState {
  if (typeof d?.id !== "string" || state.channels[d.id]?.thread === undefined) return state;
  return applyChannelDelete(state, d);
}

/** Varios hilos de una vez (posts archivados pedidos a mano): se agregan sin borrar nada. */
export function applyThreadsLoaded(state: AppState, guildId: string, threads: unknown): AppState {
  if (!Array.isArray(threads) || threads.length === 0) return state;
  const channels = { ...state.channels };
  for (const raw of threads) {
    const thread = toThread(raw, guildId, channels[(raw as any)?.id]);
    if (thread) channels[thread.id] = thread;
  }
  return { ...state, channels };
}

/**
 * THREAD_LIST_SYNC: reemplaza los hilos activos de los canales de `channel_ids` (o de todo el
 * guild si no viene). Los archivados que ya estaban y el hilo abierto se conservan.
 */
export function applyThreadListSync(state: AppState, d: any): AppState {
  const guildId = d?.guild_id;
  if (typeof guildId !== "string") return state;
  const threads: unknown[] = Array.isArray(d.threads) ? d.threads : [];
  const parents = Array.isArray(d.channel_ids)
    ? new Set(d.channel_ids.filter((id: unknown): id is string => typeof id === "string"))
    : null;
  const channels = { ...state.channels };
  for (const channel of Object.values(state.channels)) {
    if (channel.thread === undefined || channel.guildId !== guildId || channel.thread.archived) continue;
    if (channel.id === state.ui.selectedChannelId) continue;
    if (parents === null || (channel.parentId !== null && parents.has(channel.parentId))) delete channels[channel.id];
  }
  for (const raw of threads) {
    const thread = toThread(raw, guildId, state.channels[(raw as any)?.id]);
    if (thread) channels[thread.id] = thread;
  }
  return { ...state, channels };
}
