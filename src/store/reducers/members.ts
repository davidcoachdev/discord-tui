import { legacyDiscriminator, memberAvatar } from "./ready";
import type { AppState, MemberListRow, MemberState, PresenceState, UserState } from "../types";

function toUser(raw: any): UserState {
  return {
    id: raw.id,
    username: raw.username ?? raw.id,
    globalName: raw.global_name ?? null,
    avatar: raw.avatar ?? null,
    bot: raw.bot === true,
    ...legacyDiscriminator(raw),
  };
}

interface Collected {
  users: Record<string, UserState>;
  members: Record<string, MemberState>;
  presences: Record<string, PresenceState>;
}

function toRow(item: any, guildId: string, out: Collected): MemberListRow | null {
  if (item?.group && typeof item.group.id === "string") {
    return { kind: "group", id: item.group.id, count: typeof item.group.count === "number" ? item.group.count : 0 };
  }
  const member = item?.member;
  const user = member?.user;
  if (!user || typeof user.id !== "string") return null;
  out.users[user.id] = toUser(user);
  out.members[user.id] = {
    userId: user.id,
    guildId,
    roles: Array.isArray(member.roles) ? member.roles : [],
    nick: member.nick ?? null,
    ...memberAvatar(member),
  };
  if (member.presence && typeof member.presence.status === "string") {
    out.presences[user.id] = {
      status: member.presence.status,
      activities: Array.isArray(member.presence.activities) ? member.presence.activities : [],
    };
  }
  return { kind: "member", userId: user.id };
}

/** En el payload real los items `{ group: { id } }` vienen sin `count`: el conteo llega en `d.groups`. */
function groupCounts(groups: unknown, previous?: Record<string, number>): Record<string, number> | undefined {
  if (!Array.isArray(groups)) return previous;
  const out: Record<string, number> = {};
  for (const g of groups as any[]) if (typeof g?.id === "string" && typeof g?.count === "number") out[g.id] = g.count;
  return out;
}

/**
 * GUILD_MEMBER_LIST_UPDATE: SYNC, INSERT, UPDATE, DELETE e INVALIDATE sobre la lista del guild.
 * Los índices de Discord son absolutos (cuentan los encabezados de grupo), así que la lista guarda
 * cada fila en su posición y deja `null` en lo que no está cargado: con varios rangos (0-99, 200-299)
 * compactar correría las filas y los INSERT/DELETE siguientes caerían en otro lado.
 */
export function applyMemberListUpdate(state: AppState, d: any): AppState {
  if (!d || typeof d.guild_id !== "string" || !Array.isArray(d.ops)) return state;
  const guildId = d.guild_id;
  const list: (MemberListRow | null)[] = [...(state.memberLists[guildId] ?? [])];
  const out: Collected = { users: {}, members: {}, presences: {} };
  const put = (index: number, row: MemberListRow | null): void => {
    while (list.length < index) list.push(null);
    list[index] = row;
  };

  for (const op of d.ops) {
    switch (op?.op) {
      case "SYNC": {
        const [start] = Array.isArray(op.range) ? op.range : [0];
        const items: any[] = Array.isArray(op.items) ? op.items : [];
        items.forEach((item, offset) => {
          const row = toRow(item, guildId, out);
          if (row) put(start + offset, row);
        });
        break;
      }
      case "INSERT": {
        const row = toRow(op.item, guildId, out);
        if (row && typeof op.index === "number") {
          while (list.length < op.index) list.push(null);
          list.splice(op.index, 0, row);
        }
        break;
      }
      case "UPDATE": {
        const row = toRow(op.item, guildId, out);
        if (row && typeof op.index === "number") put(op.index, row);
        break;
      }
      case "DELETE":
        if (typeof op.index === "number") list.splice(op.index, 1);
        break;
      case "INVALIDATE": {
        const [start, end] = Array.isArray(op.range) ? op.range : [0, -1];
        for (let i = start; i <= end && i < list.length; i += 1) list[i] = null;
        break;
      }
      default:
        break;
    }
  }

  while (list.length > 0 && list[list.length - 1] === null) list.pop();
  const counts =
    typeof d.member_count === "number" && typeof d.online_count === "number"
      ? { ...state.memberCounts, [guildId]: { members: d.member_count, online: d.online_count, groups: groupCounts(d.groups, state.memberCounts[guildId]?.groups) } }
      : Array.isArray(d.groups) && state.memberCounts[guildId]
        ? { ...state.memberCounts, [guildId]: { ...state.memberCounts[guildId]!, groups: groupCounts(d.groups, state.memberCounts[guildId]?.groups) } }
        : state.memberCounts;
  return {
    ...state,
    users: { ...state.users, ...out.users },
    members: { ...state.members, [guildId]: { ...(state.members[guildId] ?? {}), ...out.members } },
    presences: { ...state.presences, ...out.presences },
    memberLists: { ...state.memberLists, [guildId]: list },
    memberCounts: counts,
  };
}

export function applyPresenceUpdate(state: AppState, d: any): AppState {
  const userId = d?.user?.id;
  if (typeof userId !== "string") return state;
  // Las ráfagas de presencia de servers grandes no tienen que invalidar la lista de usuarios.
  const users = d.user.username && !state.users[userId] ? { ...state.users, [userId]: toUser(d.user) } : state.users;
  const previous = state.presences[userId];
  const status = typeof d.status === "string" ? d.status : "offline";
  if (previous && previous.status === status && users === state.users && (previous.activities as unknown[]).length === 0 && !(Array.isArray(d.activities) && d.activities.length > 0)) {
    return state;
  }
  return {
    ...state,
    users,
    presences: {
      ...state.presences,
      [userId]: {
        status,
        activities: Array.isArray(d.activities) ? d.activities : [],
      },
    },
  };
}

export const TYPING_MS = 10_000;

export function applyTypingStart(state: AppState, d: any): AppState {
  if (typeof d?.channel_id !== "string" || typeof d?.user_id !== "string") return state;
  const at = typeof d.timestamp === "number" ? d.timestamp * 1000 : Date.now();
  const channel = { ...(state.typing[d.channel_id] ?? {}), [d.user_id]: at + TYPING_MS };
  let users = state.users;
  if (d.member?.user?.id) users = { ...users, [d.member.user.id]: toUser(d.member.user) };
  return { ...state, users, typing: { ...state.typing, [d.channel_id]: channel } };
}

/** Un mensaje nuevo corta el "está escribiendo" de su autor. */
export function clearTypingFor(state: AppState, channelId: string, userId: string): AppState {
  const channel = state.typing[channelId];
  if (!channel || !(userId in channel)) return state;
  const next = { ...channel };
  delete next[userId];
  return { ...state, typing: { ...state.typing, [channelId]: next } };
}

export function applyTypingSweep(state: AppState, now: number): AppState {
  let changed = false;
  const typing: AppState["typing"] = {};
  for (const [channelId, users] of Object.entries(state.typing)) {
    const kept: Record<string, number> = {};
    for (const [userId, until] of Object.entries(users)) {
      if (until > now) kept[userId] = until;
      else changed = true;
    }
    if (Object.keys(kept).length > 0) typing[channelId] = kept;
    else if (Object.keys(users).length > 0) changed = true;
  }
  return changed ? { ...state, typing } : state;
}
