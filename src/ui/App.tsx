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
import { COMMON_EMOJI } from "../emoji/common";
import { validateOutgoing } from "./composer-state";

function isOpenable(kind: string): boolean {
  return kind === "text" || kind === "dm" || kind === "group_dm";
}

export function App(props: { store: Store; actions: Actions; onQuit: () => void }): JSX.Element {
  const [insert, setInsert] = createSignal(false);
  const [replyTo, setReplyTo] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal<string | null>(null);
  const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null);
  const [hint, setHint] = createSignal<string | null>(null);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [drafts, setDrafts] = createSignal<Record<string, string>>({});
  const [lastD, setLastD] = createSignal(0);
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [pickerQuery, setPickerQuery] = createSignal("");

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

  function moveGuild(delta: number): void {
    const state = props.store.getState();
    const ids = ["@dms", ...state.guildOrder];
    const index = Math.max(0, ids.indexOf(state.ui.selectedGuildId ?? "@dms"));
    const next = ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
    if (next !== undefined) props.actions.selectGuild(next);
  }

  function moveChannel(delta: number): void {
    const state = props.store.getState();
    if (state.ui.selectedGuildId === null) return;
    const rows = selectChannelList(state, state.ui.selectedGuildId);
    if (rows.length === 0) return;
    const index = Math.max(0, rows.findIndex((row) => row.id === state.ui.selectedChannelId));
    const next = rows[Math.min(rows.length - 1, Math.max(0, index + delta))];
    if (next) props.store.dispatch({ type: "ui/selectChannel", id: next.id });
  }

  function moveMessage(delta: number): void {
    const id = channelId();
    if (id === null) return;
    const ids = selectMessages(props.store.getState(), id).map((message) => message.id);
    if (ids.length === 0) return;
    const index = selectedId() === null ? ids.length - 1 : ids.indexOf(selectedId()!);
    const next = ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
    if (next) setSelectedId(next);
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
      props.actions.focus("messages");
    }
  }

  function clearComposer(): void {
    const id = channelId();
    if (id !== null) setDrafts((previous) => ({ ...previous, [id]: "" }));
    setReplyTo(null);
    setEditing(null);
    setInsert(false);
    setHint(null);
  }

  async function submitComposer(): Promise<void> {
    const id = channelId();
    if (id === null) return;
    const text = currentText();
    const validation = validateOutgoing(text, 0);
    if (!validation.ok) return;

    if (editing() !== null) {
      const editId = editing()!;
      try {
        await props.actions.edit(id, editId, text);
      } catch {
        setHint("no se pudo editar");
        return;
      }
      clearComposer();
      return;
    }

    const reply = replyTo();
    await props.actions.send(id, text, reply === null ? {} : { replyTo: reply });
    clearComposer();
  }

  function retryFirstFailed(): void {
    const id = channelId();
    if (id === null) return;
    const failed = Object.values(props.store.getState().outbox).find(
      (item) => item.channelId === id && item.state === "failed",
    );
    if (failed) void props.actions.retry(failed.nonce);
  }

  function ownSelectedMessage(): any | undefined {
    const id = channelId();
    if (id === null || selectedId() === null) return undefined;
    return props.store.getState().messages[id]?.byId[selectedId()!];
  }

  function startEdit(): void {
    const id = channelId();
    if (id === null || selectedId() === null) return;
    const message = ownSelectedMessage();
    if (!message || message.author.id !== props.store.getState().me?.id) {
      setHint("solo podés editar o borrar tus mensajes");
      return;
    }
    setEditing(selectedId());
    setDrafts((previous) => ({ ...previous, [id]: String(message.content ?? "") }));
    setInsert(true);
  }

  function requestDelete(): void {
    if (selectedId() === null) return;
    const now = Date.now();
    if (now - lastD() < 500) {
      const message = ownSelectedMessage();
      if (!message || message.author.id !== props.store.getState().me?.id) {
        setHint("solo podés editar o borrar tus mensajes");
        return;
      }
      setConfirmDelete(selectedId());
    }
    setLastD(now);
  }

  function pickerMatches() {
    const query = pickerQuery().toLowerCase();
    return COMMON_EMOJI.filter((emoji) => emoji.name.includes(query) || emoji.char === pickerQuery());
  }

  function togglePickedReaction(): void {
    const id = channelId();
    if (id === null || selectedId() === null) {
      setHint("seleccioná un mensaje");
      return;
    }
    const match = pickerMatches()[0];
    if (match) void props.actions.toggleReaction(id, selectedId()!, { id: null, name: match.char });
    setPickerOpen(false);
    setPickerQuery("");
  }

  useKeyboard((key) => {
    if (pickerOpen()) {
      if (key.name === "escape") {
        setPickerOpen(false);
        setPickerQuery("");
        return;
      }
      if (key.name === "return") {
        togglePickedReaction();
        return;
      }
      if (key.name === "backspace") {
        setPickerQuery((previous) => previous.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && key.sequence.length === 1) {
        setPickerQuery((previous) => previous + key.sequence);
        return;
      }
      return;
    }

    if (confirmDelete() !== null) {
      if (key.name === "y") {
        const id = channelId();
        const messageId = confirmDelete();
        if (id !== null && messageId !== null) void props.actions.remove(id, messageId);
        setConfirmDelete(null);
        setSelectedId(null);
        return;
      }
      if (key.name === "n") {
        setConfirmDelete(null);
        return;
      }
      return;
    }

    if (insert()) {
      if (key.name === "escape") {
        clearComposer();
        return;
      }
      if (key.name === "return") {
        if (key.shift || key.option) setText((previous) => `${previous}\n`);
        else void submitComposer();
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

    const focus = props.store.getState().ui.focus;
    switch (key.name) {
      case "q":
        props.onQuit();
        return;
      case "i":
        setInsert(true);
        return;
      case "j":
        if (focus === "messages") moveMessage(1);
        else if (focus === "channels") moveChannel(1);
        else moveGuild(1);
        return;
      case "k":
        if (focus === "messages") moveMessage(-1);
        else if (focus === "channels") moveChannel(-1);
        else moveGuild(-1);
        return;
      case "h":
        if (focus === "messages") props.actions.focus("channels");
        else props.actions.focus("guilds");
        return;
      case "l":
        if (focus === "channels") openSelected();
        else focusChannels();
        return;
      case "return":
        openSelected();
        return;
      case "r": {
        const id = channelId();
        if (id === null) return;
        const last = selectMessages(props.store.getState(), id).at(-1);
        if (last) setReplyTo(last.id);
        return;
      }
      case "e":
        startEdit();
        return;
      case "d":
        requestDelete();
        return;
      case "R":
        retryFirstFailed();
        return;
      case "+":
        setPickerOpen(true);
        setPickerQuery("");
        return;
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
        <MessageView store={props.store} selectedId={selectedId()} />
      </box>
      <Show when={confirmDelete() !== null}>
        <box height={1} width="100%" paddingLeft={1}>
          <text>¿Borrar este mensaje? y/n</text>
        </box>
      </Show>
      <Show when={replyTo() !== null || editing() !== null}>
        <box height={1} width="100%" paddingLeft={1}>
          <text>{editing() !== null ? "editando · Esc cancela" : "respondiendo · Esc cancela"}</text>
        </box>
      </Show>
      <Show when={pickerOpen()}>
        <box height={1} width="100%" paddingLeft={1}>
          <text>{`+ ${pickerQuery() || ""}  ${pickerMatches()
            .slice(0, 6)
            .map((emoji) => `${emoji.char} ${emoji.name}`)
            .join("  ")}`}</text>
        </box>
      </Show>
      <Show when={hint() !== null}>
        <box height={1} width="100%" paddingLeft={1}>
          <text>{hint()}</text>
        </box>
      </Show>
      <Composer text={currentText()} insert={insert()} replyTo={replyTo()} editing={editing()} />
      <StatusBar store={props.store} />
    </box>
  );
}
