import type { Gateway } from "../gateway/connection";
import type { RestClient } from "../rest/client";
import { getMessages } from "../rest/routes";
import { createEditActions } from "./edit";
import { createReactActions } from "./react";
import { createSendActions } from "./send";
import { selectChannelList } from "../store/selectors";
import type { Store } from "../store/store";
import type { Focus, PendingAttachment } from "../store/types";
import { HttpError } from "../rest/errors";

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
  toggleReaction(channelId: string, messageId: string, emoji: { id: string | null; name: string }): Promise<void>;
}

export interface ActionsDeps {
  store: Store;
  rest: RestClient;
  gateway: Gateway;
}

function noticeText(action: string, error: unknown): string {
  const status = error instanceof HttpError ? error.status : null;
  return status !== null ? `no se pudo ${action}: ${status}` : `no se pudo ${action}`;
}

export function createActions(deps: ActionsDeps): Actions {
  function reportError(key: string, action: string, error: unknown): void {
    deps.store.dispatch({ type: "notice/push", key, level: "warn", text: noticeText(action, error) });
  }

  async function openChannel(id: string): Promise<void> {
    deps.store.dispatch({ type: "ui/selectChannel", id });
    const slice = deps.store.getState().messages[id];
    if (slice !== undefined && !slice.stale) return;

    try {
      const messages = await getMessages(deps.rest, id, { limit: 50 });
      deps.store.dispatch({ type: "messages/page", channelId: id, messages, mode: "latest" });
    } catch (error) {
      reportError("open-channel", "abrir el canal", error);
      throw error;
    }
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
  const reactActions = createReactActions({ store: deps.store, rest: deps.rest });

  async function edit(channelId: string, messageId: string, content: string): Promise<void> {
    try {
      await editActions.edit(channelId, messageId, content);
    } catch (error) {
      reportError("edit-message", "editar el mensaje", error);
      throw error;
    }
  }

  async function remove(channelId: string, messageId: string): Promise<void> {
    try {
      await editActions.remove(channelId, messageId);
    } catch (error) {
      reportError("remove-message", "borrar el mensaje", error);
      throw error;
    }
  }

  async function toggleReaction(
    channelId: string,
    messageId: string,
    emoji: { id: string | null; name: string },
  ): Promise<void> {
    try {
      await reactActions.toggleReaction(channelId, messageId, emoji);
    } catch (error) {
      reportError("toggle-reaction", "reaccionar", error);
      throw error;
    }
  }

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
    edit,
    remove,
    toggleReaction,
  };
}
