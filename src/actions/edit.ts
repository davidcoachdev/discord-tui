import type { RestClient } from "../rest/client";
import { deleteMessage, patchMessage } from "../rest/routes";

import type { Store } from "../store/store";

/**
 * Editar y borrar aplican la respuesta de Discord al store en el momento, como el cliente oficial, sin esperar el
 * MESSAGE_UPDATE / MESSAGE_DELETE del gateway (que llega después y no cambia nada).
 */
export function createEditActions(deps: { rest: RestClient; store?: Store }) {
  return {
    async edit(channelId: string, messageId: string, content: string): Promise<void> {
      const message = await patchMessage(deps.rest, channelId, messageId, { content });
      const d = message && typeof message === "object" && typeof message.id === "string" ? message : { id: messageId, channel_id: channelId, content };
      deps.store?.dispatch({ type: "gw", t: "MESSAGE_UPDATE", d: { ...d, channel_id: channelId } });
    },
    async remove(channelId: string, messageId: string): Promise<void> {
      await deleteMessage(deps.rest, channelId, messageId);
      deps.store?.dispatch({ type: "gw", t: "MESSAGE_DELETE", d: { id: messageId, channel_id: channelId } });
    },
  };
}
