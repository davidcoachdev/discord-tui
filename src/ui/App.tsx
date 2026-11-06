import { useRenderer, type JSX } from "@opentui/solid";
import { onCleanup, onMount } from "solid-js";

import type { Actions } from "../actions";
import { selectChannelList } from "../store/selectors";
import type { Store } from "../store/store";
import { ChannelList } from "./components/ChannelList";
import { GuildList } from "./components/GuildList";
import { MessageView } from "./components/MessageView";
import { StatusBar } from "./components/StatusBar";
import { createAppKeymap } from "./keymap";

function isOpenable(kind: string): boolean {
  return kind === "text" || kind === "dm" || kind === "group_dm";
}

export function App(props: { store: Store; actions: Actions; onQuit: () => void }): JSX.Element {
  const renderer = useRenderer();

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

  function selectFirstChannel(): void {
    const state = props.store.getState();
    if (state.ui.selectedGuildId === null) return;
    if (state.ui.selectedChannelId !== null) return;
    const first = selectChannelList(state, state.ui.selectedGuildId).find((row) => isOpenable(row.kind));
    if (first) props.store.dispatch({ type: "ui/selectChannel", id: first.id });
  }

  function focusChannels(): void {
    props.actions.focus("channels");
    selectFirstChannel();
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

  onMount(() => {
    const unsubscribe = props.store.subscribe(() => {
      const state = props.store.getState();
      if (state.ui.selectedGuildId === null && state.guildOrder.length > 0) {
        props.actions.selectGuild(state.guildOrder[0]!);
      }
    });
    onCleanup(unsubscribe);

    createAppKeymap(renderer, {
      quit: props.onQuit,
      down: () => move(1),
      up: () => move(-1),
      left: () => props.actions.focus("guilds"),
      right: () => {
        const state = props.store.getState();
        if (state.ui.focus === "channels") openSelected();
        else focusChannels();
      },
      open: openSelected,
    });
  });

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box flexDirection="row" flexGrow={1} width="100%">
        <GuildList store={props.store} actions={props.actions} />
        <ChannelList store={props.store} actions={props.actions} />
        <MessageView store={props.store} />
      </box>
      <StatusBar store={props.store} />
    </box>
  );
}
