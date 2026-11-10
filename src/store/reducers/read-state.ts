import type { AppState } from "../types";

/**
 * Automatizaciones de read state para MESSAGE_CREATE (docs.discord.food, "Read State"):
 * - un mensaje propio marca el canal como leído (y limpia las menciones);
 * - un mensaje de otro que te menciona (o llega a un DM no silenciado) suma una mención.
 * El ack del canal abierto sigue reseteando `mentionCount` después.
 */
export function applyMessageCreateReadState(state: AppState, d: any): AppState {
  const channelId = typeof d?.channel_id === "string" ? d.channel_id : null;
  const messageId = typeof d?.id === "string" ? d.id : null;
  if (channelId === null || messageId === null) return state;

  const me = state.me?.id ?? null;
  const authorId = typeof d?.author?.id === "string" ? d.author.id : null;

  if (me !== null && authorId === me) {
    return {
      ...state,
      readState: { ...state.readState, [channelId]: { lastAckedId: messageId, mentionCount: 0 } },
    };
  }

  const mentionIds = Array.isArray(d.mentions) ? d.mentions.map((user: any) => String(user.id)) : [];
  const content = String(d.content ?? "");
  const referencedAuthor = d?.referenced_message?.author?.id;
  const mentionsMe =
    (me !== null &&
      (mentionIds.includes(me) ||
        content.includes(`<@${me}>`) ||
        content.includes(`<@!${me}>`) ||
        referencedAuthor === me)) ||
    (Boolean(d.mention_everyone) && (content.includes("@everyone") || content.includes("@here")));

  const channel = state.channels[channelId];
  const isDm = channel !== undefined && channel.guildId === null;
  const muted =
    channel !== undefined &&
    (state.guildSettings.mutedChannels.includes(channelId) ||
      (channel.guildId !== null && state.guildSettings.mutedGuilds.includes(channel.guildId)));

  if (!mentionsMe && !(isDm && !muted)) return state;

  const previous = state.readState[channelId] ?? { lastAckedId: null, mentionCount: 0 };
  return {
    ...state,
    readState: { ...state.readState, [channelId]: { ...previous, mentionCount: previous.mentionCount + 1 } },
  };
}

export function applyMessageAck(state: AppState, d: any): AppState {
  const channelId = typeof d?.channel_id === "string" ? d.channel_id : null;
  const messageId = typeof d?.message_id === "string" ? d.message_id : typeof d?.id === "string" ? d.id : null;
  if (channelId === null || messageId === null) return state;

  const previous = state.readState[channelId] ?? { lastAckedId: null, mentionCount: 0 };
  return {
    ...state,
    readState: { ...state.readState, [channelId]: { lastAckedId: messageId, mentionCount: 0 } },
  };
}

export function applyChannelUnreadUpdate(state: AppState, d: any): AppState {
  const channelId = typeof d?.channel_id === "string" ? d.channel_id : null;
  if (channelId === null) return state;

  const channels = { ...state.channels };
  const channel = channels[channelId];
  if (channel && typeof d.last_message_id === "string") {
    channels[channelId] = { ...channel, lastMessageId: d.last_message_id };
  }

  const previous = state.readState[channelId] ?? { lastAckedId: null, mentionCount: 0 };
  const readState = {
    ...state.readState,
    [channelId]: {
      lastAckedId: typeof d.last_read_message_id === "string" ? d.last_read_message_id : previous.lastAckedId,
      mentionCount: typeof d.mention_count === "number" ? d.mention_count : previous.mentionCount,
    },
  };

  return { ...state, channels, readState };
}
