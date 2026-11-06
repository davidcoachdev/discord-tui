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
