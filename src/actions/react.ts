import { deleteOwnReaction, putReaction } from "../rest/routes";
import type { RestClient } from "../rest/client";
import type { Store } from "../store/store";

export function createReactActions(deps: { store: Store; rest: RestClient }) {
  return {
    async toggleReaction(channelId: string, messageId: string, emoji: { id: string | null; name: string }): Promise<void> {
      const message = deps.store.getState().messages[channelId]?.byId[messageId];
      const reaction = (message?.reactions ?? []).find(
        (item: any) => (item.emoji?.id ?? null) === emoji.id && item.emoji?.name === emoji.name,
      );
      if (reaction?.me) await deleteOwnReaction(deps.rest, channelId, messageId, emoji);
      else await putReaction(deps.rest, channelId, messageId, emoji);
    },
  };
}
