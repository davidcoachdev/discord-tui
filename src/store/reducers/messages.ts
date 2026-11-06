import type { ApiMessage, AppState, Message, MessageSlice } from "../types";
import { compareSnowflakes } from "../../util/snowflake";

const RING_SIZE = 500;

function emptySlice(): MessageSlice {
  return { ids: [], byId: {}, hasMoreBefore: true, loadingOlder: false, stale: false };
}

function withLastMessage(state: AppState, channelId: string, messageId: string): AppState {
  const channel = state.channels[channelId];
  if (!channel) return state;
  if (channel.lastMessageId !== null && compareSnowflakes(messageId, channel.lastMessageId) <= 0) return state;
  return { ...state, channels: { ...state.channels, [channelId]: { ...channel, lastMessageId: messageId } } };
}

function appendMessage(state: AppState, raw: ApiMessage): AppState {
  const channelId = raw.channel_id;
  const slice = state.messages[channelId] ?? emptySlice();
  if (slice.byId[raw.id]) return state;

  const ids = [...slice.ids, raw.id].sort(compareSnowflakes);
  const byId = { ...slice.byId, [raw.id]: raw };
  const trimmedIds = ids.length > RING_SIZE ? ids.slice(ids.length - RING_SIZE) : ids;
  const trimmedById: Record<string, ApiMessage> = {};
  for (const id of trimmedIds) trimmedById[id] = byId[id]!;

  const next = {
    ...state,
    messages: { ...state.messages, [channelId]: { ...slice, ids: trimmedIds, byId: trimmedById } },
  };
  return withLastMessage(next, channelId, raw.id);
}

function updateMessage(state: AppState, raw: Partial<ApiMessage>): AppState {
  if (typeof raw.id !== "string") return state;
  const channelId = raw.channel_id;
  if (typeof channelId !== "string") return state;
  const slice = state.messages[channelId];
  const previous = slice?.byId[raw.id];
  if (!slice || !previous) return state;

  const merged = { ...previous, ...raw } as ApiMessage;
  return { ...state, messages: { ...state.messages, [channelId]: { ...slice, byId: { ...slice.byId, [raw.id]: merged } } } };
}

function removeMessages(state: AppState, channelId: string, ids: string[]): AppState {
  const slice = state.messages[channelId];
  if (!slice) return state;
  const removing = new Set(ids);
  const keptIds = slice.ids.filter((id) => !removing.has(id));
  if (keptIds.length === slice.ids.length) return state;
  const byId = { ...slice.byId };
  for (const id of ids) delete byId[id];
  return { ...state, messages: { ...state.messages, [channelId]: { ...slice, ids: keptIds, byId } } };
}

export function applyMessageCreate(state: AppState, d: any): AppState {
  if (!d || typeof d.id !== "string" || typeof d.channel_id !== "string") return state;
  return appendMessage(state, d as ApiMessage);
}

export function applyMessageUpdate(state: AppState, d: any): AppState {
  if (!d || typeof d.id !== "string") return state;
  return updateMessage(state, d as Partial<ApiMessage>);
}

export function applyMessageDelete(state: AppState, d: any): AppState {
  if (!d || typeof d.id !== "string" || typeof d.channel_id !== "string") return state;
  return removeMessages(state, d.channel_id, [d.id]);
}

export function applyMessageDeleteBulk(state: AppState, d: any): AppState {
  if (!d || typeof d.channel_id !== "string" || !Array.isArray(d.ids)) return state;
  return removeMessages(state, d.channel_id, d.ids.filter((id: unknown) => typeof id === "string"));
}

export function applyPage(
  state: AppState,
  channelId: string,
  messages: ApiMessage[],
  mode: "older" | "latest",
): AppState {
  const previous = state.messages[channelId] ?? emptySlice();
  const byId = { ...previous.byId };
  const ids = new Set(previous.ids);
  for (const message of messages) {
    byId[message.id] = message;
    ids.add(message.id);
  }
  const ordered = [...ids].sort(compareSnowflakes);
  const trimmed = ordered.length > RING_SIZE ? ordered.slice(ordered.length - RING_SIZE) : ordered;

  return {
    ...state,
    messages: {
      ...state.messages,
      [channelId]: {
        ...previous,
        ids: trimmed,
        byId,
        loadingOlder: false,
        hasMoreBefore: mode === "older" ? messages.length >= 50 : previous.hasMoreBefore,
        stale: false,
      },
    },
  };
}

export function toMessage(state: AppState, raw: ApiMessage): Message {
  const me = state.me?.id ?? null;
  const referencedRaw = (raw as any).referenced_message;
  const referenced =
    referencedRaw && typeof referencedRaw === "object"
      ? {
          id: String(referencedRaw.id ?? ""),
          authorId: String(referencedRaw.author?.id ?? ""),
          content: String(referencedRaw.content ?? ""),
        }
      : null;

  const mentionIds = Array.isArray(raw.mentions) ? raw.mentions.map((user: any) => String(user.id)) : [];
  const content = String(raw.content ?? "");
  const mentionsMe =
    (me !== null && (mentionIds.includes(me) || content.includes(`<@${me}>`) || content.includes(`<@!${me}>`))) ||
    (Boolean(raw.mention_everyone) && (content.includes("@everyone") || content.includes("@here"))) ||
    (me !== null && referenced?.authorId === me);

  return {
    id: raw.id,
    channelId: raw.channel_id,
    authorId: raw.author?.id ?? "",
    content,
    timestamp: raw.timestamp ?? "",
    editedTimestamp: raw.edited_timestamp ?? null,
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    embeds: Array.isArray(raw.embeds) ? raw.embeds : [],
    mentionIds,
    mentionsMe,
    referenced,
    reactions: Array.isArray(raw.reactions)
      ? raw.reactions.map((reaction: any) => ({
          emoji: { id: reaction.emoji?.id ?? null, name: reaction.emoji?.name ?? "" },
          count: reaction.count ?? 0,
          me: reaction.me === true,
        }))
      : [],
    nonce: raw.nonce !== undefined && raw.nonce !== null ? String(raw.nonce) : null,
  };
}
