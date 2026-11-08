import type { AppState, ChannelState } from "../types";
import { memberAvatar, privateChannelName, toChannel, toPrivateChannel, toUser } from "./ready";

const PRIVATE_TYPES = new Set([1, 3]);

function rememberRecipients(state: AppState, raw: any): AppState {
  const recipients: any[] = Array.isArray(raw?.recipients) ? raw.recipients : [];
  if (recipients.length === 0) return state;
  const users = { ...state.users };
  for (const recipient of recipients) if (typeof recipient?.id === "string") users[recipient.id] = toUser(recipient);
  return { ...state, users };
}

/** CHANNEL_CREATE y CHANNEL_UPDATE: canales de servidor (renombrar, mover, permisos) y DMs/grupos nuevos. */
export function applyChannelUpsert(state: AppState, d: any): AppState {
  if (typeof d?.id !== "string") return state;
  const previous = state.channels[d.id];
  if (PRIVATE_TYPES.has(d.type) || (d.guild_id == null && previous?.guildId === null)) {
    const next = rememberRecipients(state, d);
    const channel: ChannelState = {
      ...toPrivateChannel(d, next.users),
      // CHANNEL_UPDATE de un grupo puede no traer last_message_id: no se pierde el que había.
      lastMessageId: d.last_message_id ?? previous?.lastMessageId ?? null,
    };
    const privateChannelIds = next.privateChannelIds.includes(d.id) ? next.privateChannelIds : [d.id, ...next.privateChannelIds];
    return { ...next, channels: { ...next.channels, [d.id]: channel }, privateChannelIds };
  }
  const guildId = typeof d.guild_id === "string" ? d.guild_id : previous?.guildId ?? null;
  if (guildId === null) return state;
  const channel = { ...toChannel(d, guildId), lastMessageId: d.last_message_id ?? previous?.lastMessageId ?? null };
  return { ...state, channels: { ...state.channels, [d.id]: channel } };
}

export function applyChannelDelete(state: AppState, d: any): AppState {
  if (typeof d?.id !== "string" || !state.channels[d.id]) return state;
  const channels = { ...state.channels };
  delete channels[d.id];
  const messages = { ...state.messages };
  delete messages[d.id];
  const ui = state.ui.selectedChannelId === d.id ? { ...state.ui, selectedChannelId: null } : state.ui;
  return { ...state, channels, messages, ui, privateChannelIds: state.privateChannelIds.filter((id) => id !== d.id) };
}

/** Alguien entra o sale de un grupo. */
export function applyRecipient(state: AppState, t: "CHANNEL_RECIPIENT_ADD" | "CHANNEL_RECIPIENT_REMOVE", d: any): AppState {
  const channel = typeof d?.channel_id === "string" ? state.channels[d.channel_id] : undefined;
  const userId = d?.user?.id;
  if (!channel || typeof userId !== "string") return state;
  const users = d.user.username ? { ...state.users, [userId]: toUser(d.user) } : state.users;
  const current = channel.recipientIds ?? [];
  const recipientIds = t === "CHANNEL_RECIPIENT_ADD" ? [...new Set([...current, userId])] : current.filter((id) => id !== userId);
  const name = privateChannelName(users, recipientIds, channel.type, channel.ownName ?? null);
  return { ...state, users, channels: { ...state.channels, [channel.id]: { ...channel, recipientIds, name } } };
}

/** El primer mensaje de un DM que no estaba en la lista (alguien te escribe por primera vez): se crea el DM. */
export function ensureDmForMessage(state: AppState, d: any): AppState {
  if (typeof d?.channel_id !== "string" || state.channels[d.channel_id] || d.guild_id) return state;
  const author = d.author;
  if (typeof author?.id !== "string" || author.id === state.me?.id) return state;
  return applyChannelUpsert(state, { id: d.channel_id, type: 1, recipients: [author], last_message_id: d.id });
}

export function applyGuildMemberUpdate(state: AppState, d: any): AppState {
  const guildId = d?.guild_id;
  const user = d?.user;
  if (typeof guildId !== "string" || typeof user?.id !== "string") return state;
  const previous = state.members[guildId]?.[user.id];
  return {
    ...state,
    users: user.username ? { ...state.users, [user.id]: toUser(user) } : state.users,
    members: {
      ...state.members,
      [guildId]: {
        ...(state.members[guildId] ?? {}),
        [user.id]: {
          userId: user.id,
          guildId,
          roles: Array.isArray(d.roles) ? d.roles : previous?.roles ?? [],
          nick: d.nick !== undefined ? d.nick : previous?.nick ?? null,
          ...memberAvatar(d, previous?.avatar),
        },
      },
    },
  };
}
