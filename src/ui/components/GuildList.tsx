import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { createEffect, For, on, type JSX } from "solid-js";

import type { Actions } from "../../actions";
import { selectChannelList, selectGuildList } from "../../store/selectors";
import type { Store } from "../../store/store";
import { cellWidth, truncate } from "../format";
import { useSelector } from "../store-bridge";
import type { Theme } from "../theme";

export const GUILD_WIDTH = 24;

function Row(props: {
  id: string;
  label: string;
  unread: boolean;
  mentions: number;
  selected: boolean;
  inVoice: boolean;
  theme: Theme;
  onClick(): void;
}): JSX.Element {
  const inner = GUILD_WIDTH - 2;
  const badge = (): string => (props.mentions > 0 ? ` ${props.mentions > 99 ? "99+" : props.mentions} ` : "");
  const marker = (): string => (props.selected ? "▌" : props.unread ? "•" : " ");
  const name = (): string => truncate(props.label, inner - 3 - cellWidth(badge()) - (props.inVoice ? 3 : 0));
  return (
    <box
      id={`guild-${props.id}`}
      flexDirection="row"
      width="100%"
      backgroundColor={props.selected ? props.theme.selection : undefined}
      onMouseDown={props.onClick}
    >
      <text fg={props.selected ? props.theme.accent : props.theme.unread}>{marker()}</text>
      <text
        flexGrow={1}
        wrapMode="none"
        fg={props.selected ? props.theme.selectionFg : props.unread ? props.theme.unread : props.theme.dim}
        attributes={props.unread || props.selected ? TextAttributes.BOLD : 0}
      >
        {` ${name()}${props.inVoice ? " 🔊" : ""}`}
      </text>
      <text fg={props.theme.modeFg} bg={props.theme.error} attributes={TextAttributes.BOLD}>
        {badge()}
      </text>
    </box>
  );
}

export function GuildList(props: { store: Store; actions: Actions; theme: Theme; focused?: boolean }): JSX.Element {
  const rows = useSelector(props.store, (state) => selectGuildList(state));
  const selected = useSelector(props.store, (state) => state.ui.selectedGuildId);
  const voiceGuild = useSelector(props.store, (state) => state.voice.guildId);
  const dms = useSelector(props.store, (state) => {
    const list = selectChannelList(state, "@dms");
    return { unread: list.some((row) => row.unread && !row.muted), mentions: list.reduce((n, row) => n + row.mentions, 0) };
  });
  let scroll: ScrollBoxRenderable | undefined;

  createEffect(
    on(selected, (id) => {
      try {
        if (id) scroll?.scrollChildIntoView(`guild-${id}`);
      } catch {
        // fuera del layout
      }
    }),
  );

  return (
    <box
      title=" Servidores "
      titleColor={props.focused ? props.theme.borderFocus : props.theme.header}
      border
      borderStyle="rounded"
      borderColor={props.focused ? props.theme.borderFocus : props.theme.border}
      width={GUILD_WIDTH}
      height="100%"
      flexDirection="column"
    >
      <scrollbox ref={(el: ScrollBoxRenderable) => (scroll = el)} width="100%" flexGrow={1}>
        <Row
          id="@dms"
          label="✉ Mensajes directos"
          unread={dms().unread}
          mentions={dms().mentions}
          selected={selected() === "@dms"}
          inVoice={false}
          theme={props.theme}
          onClick={() => props.actions.selectGuild("@dms")}
        />
        <box height={1} width="100%">
          <text fg={props.theme.faint} wrapMode="none">{"─".repeat(GUILD_WIDTH - 2)}</text>
        </box>
        <For each={rows()}>
          {(row) => (
            <Row
              id={row.id}
              label={row.name}
              unread={row.unread}
              mentions={row.mentions}
              selected={selected() === row.id}
              inVoice={voiceGuild() === row.id}
              theme={props.theme}
              onClick={() => props.actions.selectGuild(row.id)}
            />
          )}
        </For>
      </scrollbox>
    </box>
  );
}
