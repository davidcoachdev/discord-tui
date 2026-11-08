import type { APIMessage } from "discord-api-types/v9";

import type { RestClient } from "./client";

export async function getMessages(
  rest: RestClient,
  channelId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<APIMessage[]> {
  const params = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.before) params.set("before", opts.before);
  return rest.request<APIMessage[]>("GET", `/channels/${channelId}/messages?${params.toString()}`);
}

export async function postMessage(
  rest: RestClient,
  channelId: string,
  body: {
    content: string;
    nonce: string;
    tts: false;
    flags: number;
    message_reference?: { message_id: string; channel_id: string; guild_id?: string };
    allowed_mentions?: { parse: string[]; replied_user: boolean };
    attachments?: unknown[];
  },
): Promise<APIMessage> {
  return rest.request<APIMessage>("POST", `/channels/${channelId}/messages`, body);
}

export async function postTyping(rest: RestClient, channelId: string): Promise<void> {
  await rest.request("POST", `/channels/${channelId}/typing`);
}

export async function postAck(rest: RestClient, channelId: string, messageId: string): Promise<void> {
  await rest.request("POST", `/channels/${channelId}/messages/${messageId}/ack`, { token: null, last_viewed: 0 });
}

export async function patchMessage(
  rest: RestClient,
  channelId: string,
  messageId: string,
  body: { content: string },
): Promise<APIMessage> {
  return rest.request<APIMessage>("PATCH", `/channels/${channelId}/messages/${messageId}`, body);
}

export async function deleteMessage(rest: RestClient, channelId: string, messageId: string): Promise<void> {
  await rest.request("DELETE", `/channels/${channelId}/messages/${messageId}`);
}

export async function putReaction(
  rest: RestClient,
  channelId: string,
  messageId: string,
  emoji: { id: string | null; name: string },
): Promise<void> {
  const path = encodeURIComponent(emoji.id !== null ? `${emoji.name}:${emoji.id}` : emoji.name);
  await rest.request("PUT", `/channels/${channelId}/messages/${messageId}/reactions/${path}/@me`);
}

/** Vota en una encuesta (docs.discord.food, "Create Poll Vote"): `answer_ids` vacío saca el voto. 204 sin cuerpo. */
export async function putPollVote(rest: RestClient, channelId: string, messageId: string, answerIds: number[]): Promise<void> {
  await rest.request("PUT", `/channels/${channelId}/polls/${messageId}/answers/@me`, { answer_ids: answerIds });
}

export async function deleteOwnReaction(
  rest: RestClient,
  channelId: string,
  messageId: string,
  emoji: { id: string | null; name: string },
): Promise<void> {
  const path = encodeURIComponent(emoji.id !== null ? `${emoji.name}:${emoji.id}` : emoji.name);
  await rest.request("DELETE", `/channels/${channelId}/messages/${messageId}/reactions/${path}/@me`);
}

export interface ThreadSearchResult {
  threads?: unknown[];
  has_more?: boolean;
  /** 202 "Index not yet available": viene `code` 110000 y `retry_after` en vez de `threads`. */
  code?: number;
}

/** Posts archivados de un foro, los de actividad más reciente primero (25 por página). */
export async function searchArchivedThreads(
  rest: RestClient,
  channelId: string,
  opts: { offset?: number } = {},
): Promise<ThreadSearchResult> {
  const params = new URLSearchParams({
    archived: "true",
    sort_by: "last_message_time",
    sort_order: "desc",
    limit: "25",
    offset: String(opts.offset ?? 0),
  });
  return rest.request<ThreadSearchResult>("GET", `/channels/${channelId}/threads/search?${params.toString()}`);
}
