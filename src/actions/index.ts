import type { Gateway } from "../gateway/connection";
import type { RestClient } from "../rest/client";
import { getMessages, postAck, postTyping } from "../rest/routes";
import { buildGuildSubscription } from "../gateway/subscriptions";
import { uploadAttachments } from "../uploads/upload";
import { createAckScheduler } from "./ack";
import { createTypingNotifier } from "./typing";
import type { VoiceActions } from "./voice";
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
  /** Cada tecla escrita en el composer: manda typing como máximo cada 8 s. */
  keystroke?(channelId: string, textAfter: string): void;
  /** El canal que se está mirando y su mensaje más nuevo: ack con debounce. */
  viewing?(channelId: string | null, newestId: string | null): void;
  voice?: VoiceActions;
}

export interface ActionsDeps {
  store: Store;
  rest: RestClient;
  gateway: Pick<Gateway, "send">;
  fetch?: typeof fetch;
  voice?: VoiceActions;
  now?: () => number;
}

function noticeText(action: string, error: unknown): string {
  const status = error instanceof HttpError ? error.status : null;
  return status !== null ? `no se pudo ${action}: ${status}` : `no se pudo ${action}`;
}

export function createActions(deps: ActionsDeps): Actions {
  function reportError(key: string, action: string, error: unknown): void {
    deps.store.dispatch({ type: "notice/push", key, level: "warn", text: noticeText(action, error) });
  }

  function subscribeGuild(channelId: string): void {
    const state = deps.store.getState();
    const guildId = state.channels[channelId]?.guildId;
    if (!guildId || state.subscribedChannels[guildId] === channelId) return;
    const payload = buildGuildSubscription(guildId, channelId);
    deps.gateway.send(payload.op, payload.d);
    deps.store.dispatch({ type: "members/subscribed", guildId, channelId });
  }

  async function openChannel(id: string): Promise<void> {
    deps.store.dispatch({ type: "ui/selectChannel", id });
    const kind = deps.store.getState().channels[id]?.type;
    if (kind === 2 || kind === 4) return;
    subscribeGuild(id);
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

  const fetchFn = deps.fetch ?? fetch;
  const sendActions = createSendActions({
    store: deps.store,
    rest: deps.rest,
    upload: (channelId, files) => uploadAttachments(deps.rest, fetchFn, channelId, files),
  });
  const typing = createTypingNotifier({ postTyping: (id) => postTyping(deps.rest, id), now: deps.now ?? Date.now });
  const ack = createAckScheduler({
    postAck: async (channelId, messageId) => {
      deps.store.dispatch({ type: "gw", t: "MESSAGE_ACK", d: { channel_id: channelId, message_id: messageId } });
      await postAck(deps.rest, channelId, messageId);
    },
  });
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
    send: async (channelId, content, opts) => {
      typing.onSent(channelId);
      await sendActions.send(channelId, content, opts);
    },
    keystroke: (channelId, textAfter) => typing.onKeystroke(channelId, textAfter),
    viewing: (channelId, newestId) => ack.viewing(channelId, newestId),
    voice: deps.voice,
    retry: sendActions.retry,
    edit,
    remove,
    toggleReaction,
  };
}
