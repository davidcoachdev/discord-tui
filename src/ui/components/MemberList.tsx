import { TextAttributes } from "@opentui/core";
import { For, Show, type JSX } from "solid-js";

import { selectMemberRows } from "../../store/selectors";
import type { Store } from "../../store/store";
import { displayName, hashIndex, memberColor, truncate } from "../format";
import { useSelector } from "../store-bridge";
import { presenceColor, roleHex, type Theme } from "../theme";

export const MEMBER_WIDTH = 26;

export function MemberList(props: { store: Store; theme: Theme }): JSX.Element {
  const state = useSelector(props.store, (s) => s);
  const guildId = (): string | null => {
    const channelId = state().ui.selectedChannelId;
    const fromChannel = channelId ? state().channels[channelId]?.guildId : null;
    if (fromChannel) return fromChannel;
    const selected = state().ui.selectedGuildId;
    return selected && selected !== "@dms" ? selected : null;
  };
  const rows = () => (guildId() ? selectMemberRows(state(), guildId()!).slice(0, 200) : []);
  const inner = MEMBER_WIDTH - 2;

  return (
    <box
      title=" Miembros "
      titleColor={props.theme.header}
      border
      borderStyle="rounded"
      borderColor={props.theme.border}
      width={MEMBER_WIDTH}
      height="100%"
      flexDirection="column"
    >
      <Show when={rows().length === 0}>
        <text fg={props.theme.dim}>{guildId() ? " cargando…" : " (solo en servidores)"}</text>
      </Show>
      <scrollbox width="100%" flexGrow={1}>
        <For each={rows()}>
          {(row) =>
            row.kind === "group" ? (
              <box width="100%" marginTop={1}>
                <text fg={props.theme.dim} attributes={TextAttributes.BOLD} wrapMode="none">
                  {truncate(`${row.label.toUpperCase()} — ${row.count}`, inner)}
                </text>
              </box>
            ) : (
              <box flexDirection="row" width="100%">
                <text fg={presenceColor(props.theme, row.status)}>{row.status === "offline" ? " ○" : " ●"}</text>
                <text
                  wrapMode="none"
                  fg={
                    row.status === "offline"
                      ? props.theme.faint
                      : roleHex(memberColor(state(), row.userId, guildId())) ??
                        props.theme.names[hashIndex(row.userId, props.theme.names.length)]
                  }
                >
                  {` ${truncate(displayName(state(), row.userId, guildId()), inner - 4)}`}
                </text>
              </box>
            )
          }
        </For>
      </scrollbox>
    </box>
  );
}
