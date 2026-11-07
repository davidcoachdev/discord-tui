import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { createEffect, For, on, Show, type JSX } from "solid-js";

import type { Actions } from "../../actions";
import { selectChannelList, selectVoiceParticipants, type ChannelRow } from "../../store/selectors";
import type { Store } from "../../store/store";
import type { AppState } from "../../store/types";
import { cellWidth, displayName, truncate } from "../format";
import { jsonEqual, useSelector } from "../store-bridge";
import type { Theme } from "../theme";

export const CHANNEL_WIDTH = 32;

function icon(kind: ChannelRow["kind"]): string {
  if (kind === "voice") return "🔊";
  if (kind === "dm") return "@";
  if (kind === "group_dm") return "👥";
  return "#";
}

interface ParticipantView {
  userId: string;
  name: string;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  me: boolean;
  volume: number;
}

interface ListView {
  title: string;
  rows: ChannelRow[];
  participants: Record<string, ParticipantView[]>;
  voiceChannelId: string | null;
}

function listView(s: AppState): ListView {
  const selectedGuild = s.ui.selectedGuildId;
  const guildId = selectedGuild === null || selectedGuild === "@dms" ? null : selectedGuild;
  const rows = selectedGuild === null ? [] : selectChannelList(s, selectedGuild);
  const participants: Record<string, ParticipantView[]> = {};
  if (guildId !== null) {
    for (const row of rows) {
      if (row.kind !== "voice") continue;
      participants[row.id] = selectVoiceParticipants(s, guildId, row.id).map((p) => ({
        ...p,
        name: displayName(s, p.userId, guildId),
        volume: s.settings.userVolumes[p.userId] ?? 100,
      }));
    }
  }
  const title =
    selectedGuild === "@dms"
      ? " Mensajes directos "
      : ` ${truncate((guildId ? s.guilds[guildId]?.name : null) ?? "Canales", CHANNEL_WIDTH - 6)} `;
  return { title, rows, participants, voiceChannelId: s.voice.channelId };
}

export function ChannelList(props: {
  store: Store;
  actions: Actions;
  theme: Theme;
  focused?: boolean;
  selectedParticipant?: string | null;
}): JSX.Element {
  const view = useSelector(props.store, listView, jsonEqual);
  const selected = useSelector(props.store, (s) => s.ui.selectedChannelId);
  const rows = (): ChannelRow[] => view().rows;
  const title = (): string => view().title;
  const inner = CHANNEL_WIDTH - 2;
  let scroll: ScrollBoxRenderable | undefined;

  createEffect(
    on(selected, (id) => {
      try {
        if (id) scroll?.scrollChildIntoView(`chan-${id}`);
      } catch {
        // fuera del layout
      }
    }),
  );

  function open(row: ChannelRow): void {
    if (row.kind === "category") return;
    props.store.dispatch({ type: "ui/selectChannel", id: row.id });
    if (row.kind === "voice") return;
    void props.actions.openChannel(row.id).catch(() => {});
  }

  return (
    <box
      title={title()}
      titleColor={props.focused ? props.theme.borderFocus : props.theme.header}
      border
      borderStyle="rounded"
      borderColor={props.focused ? props.theme.borderFocus : props.theme.border}
      width={CHANNEL_WIDTH}
      height="100%"
      flexDirection="column"
    >
      <Show when={rows().length === 0}>
        <text fg={props.theme.dim}> (sin canales)</text>
      </Show>
      <scrollbox ref={(el: ScrollBoxRenderable) => (scroll = el)} width="100%" flexGrow={1}>
        <For each={rows()}>
          {(row) => {
            if (row.kind === "category") {
              return (
                <box id={`chan-${row.id}`} width="100%" marginTop={1}>
                  <text fg={props.theme.dim} attributes={TextAttributes.BOLD} wrapMode="none">
                    {`⌄ ${truncate(row.name.toUpperCase(), inner - 2)}`}
                  </text>
                </box>
              );
            }
            const isSel = (): boolean => selected() === row.id;
            const badge = row.mentions > 0 ? ` ${row.mentions > 99 ? "99+" : row.mentions} ` : "";
            const lead = `${"  ".repeat(row.depth)}${icon(row.kind)} `;
            const name = truncate(row.name, inner - 1 - cellWidth(lead) - cellWidth(badge));
            const bright = row.unread && !row.muted;
            const participants = (): ParticipantView[] => view().participants[row.id] ?? [];
            const connectedHere = (): boolean => view().voiceChannelId === row.id;
            return (
              <box flexDirection="column" width="100%">
                <box
                  id={`chan-${row.id}`}
                  flexDirection="row"
                  width="100%"
                  backgroundColor={isSel() ? props.theme.selection : undefined}
                  onMouseDown={() => open(row)}
                >
                  <text fg={props.theme.accent}>{isSel() ? "▌" : " "}</text>
                  <text
                    flexGrow={1}
                    wrapMode="none"
                    fg={
                      connectedHere()
                        ? props.theme.speaking
                        : isSel()
                          ? props.theme.selectionFg
                          : bright
                            ? props.theme.unread
                            : row.muted
                              ? props.theme.faint
                              : props.theme.dim
                    }
                    attributes={bright || isSel() ? TextAttributes.BOLD : 0}
                  >
                    {`${lead}${name}`}
                  </text>
                  <text fg={props.theme.modeFg} bg={props.theme.error} attributes={TextAttributes.BOLD}>
                    {badge}
                  </text>
                </box>
                <For each={participants()}>
                  {(p) => (
                    <box
                      flexDirection="row"
                      width="100%"
                      paddingLeft={row.depth * 2 + 3}
                      backgroundColor={isSel() && props.selectedParticipant === p.userId ? props.theme.selection : undefined}
                    >
                      <text fg={p.speaking ? props.theme.speaking : props.theme.faint}>{p.speaking ? "●" : "○"}</text>
                      <text
                        flexGrow={1}
                        wrapMode="none"
                        fg={p.speaking ? props.theme.speaking : p.me ? props.theme.fg : props.theme.dim}
                      >
                        {` ${truncate(p.name, inner - row.depth * 2 - 12)}`}
                      </text>
                      <text fg={props.theme.accent}>{p.volume !== 100 ? `${p.volume}% ` : ""}</text>
                      <text fg={p.deafened ? props.theme.error : props.theme.warn}>
                        {p.deafened ? "[deaf]" : p.muted ? "[mute]" : ""}
                      </text>
                    </box>
                  )}
                </For>
              </box>
            );
          }}
        </For>
      </scrollbox>
    </box>
  );
}
