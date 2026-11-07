import { useKeyboard, type JSX } from "@opentui/solid";
import { createSignal, onCleanup, onMount, Show } from "solid-js";

import type { Actions } from "../actions";
import { selectChannelList, selectMessages } from "../store/selectors";
import type { Store } from "../store/store";
import { Composer } from "./components/Composer";
import { ChannelList } from "./components/ChannelList";
import { GuildList } from "./components/GuildList";
import { MessageView } from "./components/MessageView";
import { StatusBar } from "./components/StatusBar";
import { validateOutgoing } from "./composer-state";

function isOpenable(kind: string): boolean {
  return kind === "text" || kind === "dm" || kind === "group_dm";
}

export function App(props: { store: Store; actions: Actions; onQuit: () => void }): JSX.Element {
  const [insert, setInsert] = createSignal(false);
  const [replyTo, setReplyTo] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal<string | null>(null);
  const [drafts, setDrafts] = createSignal<Record<string, string>>({});

  const channelId = (): string | null => props.store.getState().ui.selectedChannelId;
  const currentText = (): string => {
    const id = channelId();
    return id === null ? "" : drafts()[id] ?? "";
  };

  function setText(updater: (previous: string) => string): void {
    const id = channelId();
    if (id === null) return;
    setDrafts((previous) => ({ ...previous, [id]: updater(previous[id] ?? "") }));
  }

  function move(delta: number): void {
    const state = props.store.getState();
    if (state.ui.focus === "channels" && state.ui.selectedGuildId !== null) {
      const rows = selectChannelList(state, state.ui.selectedGuildId);
      if (rows.length === 0) return;
      const index = Math.max(0, rows.findIndex((row) => row.id === state.ui.selectedChannelId));
      const next = rows[Math.min(rows.length - 1, Math.max(0, index + delta))];
      if (next) props.store.dispatch({ type: "ui/selectChannel", id: next.id });
      return;
    }

    const ids = ["@dms", ...state.guildOrder];
    const index = Math.max(0, ids.indexOf(state.ui.selectedGuildId ?? "@dms"));
    const next = ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
    if (next !== undefined) props.actions.selectGuild(next);
  }

  function focusChannels(): void {
    props.actions.focus("channels");
    const state = props.store.getState();
    if (state.ui.selectedGuildId === null || state.ui.selectedChannelId !== null) return;
    const first = selectChannelList(state, state.ui.selectedGuildId).find((row) => isOpenable(row.kind));
    if (first) props.store.dispatch({ type: "ui/selectChannel", id: first.id });
  }

  function openSelected(): void {
    const state = props.store.getState();
    if (state.ui.focus === "guilds") {
      focusChannels();
      return;
    }
    if (state.ui.selectedChannelId !== null) {
      void props.actions.openChannel(state.ui.selectedChannelId).catch(() => {});
    }
  }

  async function sendCurrent(): Promise<void> {
    const id = channelId();
    if (id === null) return;
    const text = currentText();
    const validation = validateOutgoing(text, 0);
    if (!validation.ok) return;

    const reply = replyTo();
    await props.actions.send(id, text, reply === null ? {} : { replyTo: reply });
    setDrafts((previous) => ({ ...previous, [id]: "" }));
    setReplyTo(null);
    setEditing(null);
    setInsert(false);
  }

  function retryFirstFailed(): void {
    const id = channelId();
    if (id === null) return;
    const failed = Object.values(props.store.getState().outbox).find(
      (item) => item.channelId === id && item.state === "failed",
    );
    if (failed) void props.actions.retry(failed.nonce);
  }

  useKeyboard((key) => {
    if (insert()) {
      if (key.name === "escape") {
        setInsert(false);
        setReplyTo(null);
        setEditing(null);
        return;
      }
      if (key.name === "return") {
        if (key.shift || key.option) {
          setText((previous) => `${previous}\n`);
          return;
        }
        void sendCurrent();
        return;
      }
      if (key.name === "backspace") {
        setText((previous) => previous.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && key.sequence.length === 1) {
        setText((previous) => previous + key.sequence);
        return;
      }
      return;
    }

    switch (key.name) {
      case "q":
        props.onQuit();
        return;
      case "i":
        setInsert(true);
        return;
      case "j":
        move(1);
        return;
      case "k":
        move(-1);
        return;
      case "h":
        props.actions.focus("guilds");
        return;
      case "l":
        if (props.store.getState().ui.focus === "channels") openSelected();
        else focusChannels();
        return;
      case "return":
        openSelected();
        return;
      case "R":
        retryFirstFailed();
        return;
      case "r": {
        const id = channelId();
        if (id === null) return;
        const last = selectMessages(props.store.getState(), id).at(-1);
        if (last) setReplyTo(last.id);
        return;
      }
      default:
        return;
    }
  });

  onMount(() => {
    const unsubscribe = props.store.subscribe(() => {
      const state = props.store.getState();
      if (state.ui.selectedGuildId === null && state.guildOrder.length > 0) {
        props.actions.selectGuild(state.guildOrder[0]!);
      }
    });
    onCleanup(unsubscribe);
  });

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box flexDirection="row" flexGrow={1} width="100%">
        <GuildList store={props.store} actions={props.actions} />
        <ChannelList store={props.store} actions={props.actions} />
        <MessageView store={props.store} />
      </box>
      <Show when={replyTo() !== null || editing() !== null}>
        <box height={1} width="100%" paddingLeft={1}>
          <text>{editing() !== null ? "editando · Esc cancela" : "respondiendo · Esc cancela"}</text>
        </box>
      </Show>
      <Composer text={currentText()} insert={insert()} replyTo={replyTo()} editing={editing()} />
      <StatusBar store={props.store} />
    </box>
  );
}
