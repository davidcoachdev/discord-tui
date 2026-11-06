import type { AppState } from "../types";

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
