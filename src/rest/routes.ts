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
