import { compareSnowflakes } from "../util/snowflake";
import { canViewChannel } from "./permissions";
import { toMessage } from "./reducers/messages";
import type { ApiMessage, AppState, ChannelState, Message } from "./types";

export interface ChannelRow {
  id: string;
  name: string;
  kind: "text" | "voice" | "category" | "dm" | "group_dm";
  unread: boolean;
  mentions: number;
  muted: boolean;
  depth: 0 | 1;
}

export interface GuildRow {
  id: string;
  name: string;
  unread: boolean;
  mentions: number;
}

const TEXT_TYPES = new Set([0, 5]);
const VOICE_TYPES = new Set([2]);

function kindOf(channel: ChannelState): ChannelRow["kind"] | null {
  if (TEXT_TYPES.has(channel.type)) return "text";
  if (VOICE_TYPES.has(channel.type)) return "voice";
  if (channel.type === 4) return "category";
  if (channel.type === 1) return "dm";
  if (channel.type === 3) return "group_dm";
  return null;
}

export function isChannelUnread(state: AppState, channelId: string): boolean {
  const channel = state.channels[channelId];
  if (!channel || channel.lastMessageId === null) return false;
  const read = state.readState[channelId];
  if (!read?.lastAckedId) return true;
  return compareSnowflakes(channel.lastMessageId, read.lastAckedId) > 0;
}

export function isChannelMuted(state: AppState, guildId: string | null, channelId: string): boolean {
  if (state.guildSettings.mutedChannels.includes(channelId)) return true;
  return guildId !== null && state.guildSettings.mutedGuilds.includes(guildId);
}

function toRow(state: AppState, channel: ChannelState, depth: 0 | 1): ChannelRow {
  const kind = kindOf(channel);
  return {
    id: channel.id,
    name: channel.name,
    kind: kind ?? "text",
    unread: isChannelUnread(state, channel.id),
    mentions: state.readState[channel.id]?.mentionCount ?? 0,
    muted: isChannelMuted(state, channel.guildId, channel.id),
    depth,
  };
}

function byPosition(a: ChannelState, b: ChannelState): number {
  return a.position - b.position || compareSnowflakes(a.id, b.id);
}

export function selectChannelList(state: AppState, guildId: string | "@dms"): ChannelRow[] {
  if (guildId === "@dms") {
    return state.privateChannelIds
      .map((id) => state.channels[id])
      .filter((channel): channel is ChannelState => channel !== undefined)
      .map((channel) => toRow(state, channel, 0));
  }

  const visible = Object.values(state.channels).filter(
    (channel) => channel.guildId === guildId && canViewChannel(state, guildId, channel.id) && kindOf(channel) !== null,
  );

  const categories = visible.filter((channel) => channel.type === 4).sort(byPosition);
  const rows: ChannelRow[] = [];
  const placed = new Set<string>();

  for (const category of categories) {
    rows.push(toRow(state, category, 0));
    placed.add(category.id);
    const children = visible.filter((channel) => channel.type !== 4 && channel.parentId === category.id).sort(byPosition);
    for (const child of children) {
      rows.push(toRow(state, child, 1));
      placed.add(child.id);
    }
  }

  for (const channel of visible.filter((candidate) => candidate.type !== 4 && !placed.has(candidate.id)).sort(byPosition)) {
    rows.push(toRow(state, channel, 0));
  }

  return rows;
}

export function selectGuildList(state: AppState): GuildRow[] {
  return state.guildOrder.map((id) => {
    const guild = state.guilds[id];
    const rows = selectChannelList(state, id);
    return {
      id,
      name: guild?.name ?? id,
      unread: rows.some((row) => row.unread),
      mentions: rows.reduce((total, row) => total + row.mentions, 0),
    };
  });
}

export function selectNextUnread(state: AppState, fromChannelId: string | null): string | null {
  const groups: Array<string | "@dms"> = [...state.guildOrder, "@dms"];
  const rows = groups.flatMap((guildId) => selectChannelList(state, guildId));
  if (rows.length === 0) return null;

  const start = fromChannelId === null ? -1 : rows.findIndex((row) => row.id === fromChannelId);
  for (let offset = 1; offset <= rows.length; offset += 1) {
    const row = rows[(start + offset + rows.length) % rows.length]!;
    if (row.unread && !row.muted) return row.id;
  }
  return null;
}

export function selectMessages(state: AppState, channelId: string): Message[] {
  const slice = state.messages[channelId];
  if (!slice) return [];
  return slice.ids
    .map((id) => slice.byId[id])
    .filter((message): message is ApiMessage => message !== undefined)
    .map((message) => toMessage(state, message));
}

export function selectOutbox(state: AppState, channelId: string): import("./types").OutboxItem[] {
  return Object.values(state.outbox)
    .filter((item) => item.channelId === channelId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Quiénes están escribiendo en el canal (sin uno mismo ni vencidos). */
export function selectTyping(state: AppState, channelId: string, now: number): string[] {
  const entries = state.typing[channelId];
  if (!entries) return [];
  return Object.entries(entries)
    .filter(([userId, until]) => until > now && userId !== state.me?.id)
    .map(([userId]) => userId);
}

export interface VoiceParticipant {
  userId: string;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  me: boolean;
}

/** Participantes de un canal de voz, con quién habla (uno mismo incluido). */
export function selectVoiceParticipants(state: AppState, guildId: string, channelId: string): VoiceParticipant[] {
  const states = state.voice.states[guildId] ?? {};
  const meId = state.me?.id ?? null;
  return Object.entries(states)
    .filter(([, voice]) => voice.channelId === channelId)
    .map(([userId, voice]) => {
      const me = userId === meId;
      return {
        userId,
        me,
        speaking: me ? state.voice.selfSpeaking && state.voice.channelId === channelId : state.voice.speaking[userId] === true,
        muted: voice.selfMute || voice.mute,
        deafened: voice.selfDeaf || voice.deaf,
      };
    })
    .sort((a, b) => compareSnowflakes(a.userId, b.userId));
}

export type MemberRow =
  | { kind: "group"; label: string; count: number }
  | { kind: "member"; userId: string; status: string };

const GROUP_LABELS: Record<string, string> = { online: "En línea", offline: "Desconectados" };

/** Filas de la lista de miembros del guild: la que mandó op 37 o, si no llegó, los miembros conocidos. */
export function selectMemberRows(state: AppState, guildId: string): MemberRow[] {
  const list = state.memberLists[guildId];
  const statusOf = (userId: string): string => state.presences[userId]?.status ?? "offline";
  if (list && list.length > 0) {
    const roles = state.guilds[guildId]?.roles ?? [];
    return list.map((row) =>
      row.kind === "group"
        ? { kind: "group" as const, label: GROUP_LABELS[row.id] ?? roles.find((role) => role.id === row.id)?.name ?? row.id, count: row.count }
        : { kind: "member" as const, userId: row.userId, status: statusOf(row.userId) },
    );
  }
  const members = Object.keys(state.members[guildId] ?? {});
  const online = members.filter((id) => statusOf(id) !== "offline");
  const offline = members.filter((id) => statusOf(id) === "offline");
  const rows: MemberRow[] = [];
  if (online.length > 0) rows.push({ kind: "group", label: "En línea", count: online.length });
  for (const id of online) rows.push({ kind: "member", userId: id, status: statusOf(id) });
  if (offline.length > 0) rows.push({ kind: "group", label: "Desconectados", count: offline.length });
  for (const id of offline) rows.push({ kind: "member", userId: id, status: "offline" });
  return rows;
}
