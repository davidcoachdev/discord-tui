import type { Gateway } from "../gateway/connection";
import type { RestClient } from "../rest/client";
import { getMessages } from "../rest/routes";
import { createEditActions } from "./edit";
import { createSendActions } from "./send";
import { selectChannelList } from "../store/selectors";
import type { Store } from "../store/store";
import type { Focus, PendingAttachment } from "../store/types";

export interface Actions {
  selectGuild(id: string | "@dms"): void;
  openChannel(id: string): Promise<void>;
  loadOlder(id: string): Promise<void>;
  focus(focus: Focus): void;
  toggleMembers(): void;
  send(channelId: string, content: string, opts?: { replyTo?: string; attachments?: PendingAttachment[] }): Promise<void>;
  retry(nonce: string): Promise<void>;
  edit(channelId: string, messageId: string, content: string): Promise<void>;
  remove(channelId: string, messageId: string): Promise<void>;
}

export interface ActionsDeps {
  store: Store;
  rest: RestClient;
  gateway: Gateway;
}

export function createActions(deps: ActionsDeps): Actions {
  async function openChannel(id: string): Promise<void> {
    deps.store.dispatch({ type: "ui/selectChannel", id });
    const slice = deps.store.getState().messages[id];
    if (slice !== undefined && !slice.stale) return;

    const messages = await getMessages(deps.rest, id, { limit: 50 });
    deps.store.dispatch({ type: "messages/page", channelId: id, messages, mode: "latest" });
  }

  async function loadOlder(id: string): Promise<void> {
    const slice = deps.store.getState().messages[id];
    if (!slice || slice.loadingOlder || !slice.hasMoreBefore) return;
    const oldest = slice.ids[0];
    if (oldest === undefined) return;

    deps.store.dispatch({ type: "messages/loading", channelId: id, loading: true });
    try {
      const messages = await getMessages(deps.rest, id, { before: oldest, limit: 50 });
      deps.store.dispatch({ type: "messages/page", channelId: id, messages, mode: "older" });
    } finally {
      deps.store.dispatch({ type: "messages/loading", channelId: id, loading: false });
    }
  }

  const sendActions = createSendActions({ store: deps.store, rest: deps.rest });
  const editActions = createEditActions({ rest: deps.rest });

  return {
    selectGuild(id: string | "@dms"): void {
      deps.store.dispatch({ type: "ui/selectGuild", id });
      const first = selectChannelList(deps.store.getState(), id).find(
        (row) => row.kind === "text" || row.kind === "dm" || row.kind === "group_dm",
      );
      if (first) void openChannel(first.id).catch(() => {});
    },
    openChannel,
    loadOlder,
    focus(focus: Focus): void {
      deps.store.dispatch({ type: "ui/focus", focus });
    },
    toggleMembers(): void {
      deps.store.dispatch({ type: "ui/toggleMembers" });
    },
    send: sendActions.send,
    retry: sendActions.retry,
    edit: editActions.edit,
    remove: editActions.remove,
  };
}
