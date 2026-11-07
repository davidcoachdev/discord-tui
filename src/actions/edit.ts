import type { RestClient } from "../rest/client";
import { deleteMessage, patchMessage } from "../rest/routes";

export function createEditActions(deps: { rest: RestClient }) {
  return {
    async edit(channelId: string, messageId: string, content: string): Promise<void> {
      await patchMessage(deps.rest, channelId, messageId, { content });
    },
    async remove(channelId: string, messageId: string): Promise<void> {
      await deleteMessage(deps.rest, channelId, messageId);
    },
  };
}
