import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { For, Show, type JSX } from "solid-js";

import { AVATAR_COLS, userAvatarUrl } from "../../images/avatar";
import { selectDmMemberRows, selectMemberRows } from "../../store/selectors";
import type { Store } from "../../store/store";
import { displayName, hashIndex, memberColor, truncate } from "../format";
import { jsonEqual, useSelector } from "../store-bridge";
import { presenceColor, roleHex, type Theme } from "../theme";
import { Avatar } from "./Avatar";

export const MEMBER_WIDTH = 26;

/** Filas desde el final de lo cargado en las que la rueda pide la ventana siguiente. */
const NEAR_END_ROWS = 8;

/** 14814 → "14.814". */
export function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function MemberList(props: {
  store: Store;
  theme: Theme;
  /** Imágenes inline prendidas: el avatar se baja; si no, queda la inicial. */
  images?: boolean;
  onMember?(userId: string): void;
  /** La rueda llegó cerca del final de lo cargado (solo por scroll del usuario). */
  onNearEnd?(): void;
}): JSX.Element {
  const view = useSelector(
    props.store,
    (s) => {
      const channelId = s.ui.selectedChannelId;
      const fromChannel = channelId ? s.channels[channelId]?.guildId : null;
      const selected = s.ui.selectedGuildId;
      const guildId = fromChannel ?? (selected && selected !== "@dms" ? selected : null);
      const inDm = channelId !== null && s.channels[channelId]?.guildId === null;
      const base = inDm ? selectDmMemberRows(s, channelId!) : guildId ? selectMemberRows(s, guildId) : [];
      const rows = base.length > 0
        ? base
            .map((row) =>
              row.kind === "group"
                ? row
                : {
                    ...row,
                    name: displayName(s, row.userId, guildId),
                    color: memberColor(s, row.userId, guildId),
                    avatar: s.settings.showAvatars ? userAvatarUrl(s, row.userId, guildId, s.settings.animateImages) : null,
                  },
            )
        : [];
      const total = !inDm && guildId ? s.memberCounts[guildId]?.members ?? null : null;
      return { guildId, rows, total };
    },
    jsonEqual,
  );
  const guildId = (): string | null => view().guildId;
  const rows = () => view().rows;
  const inner = MEMBER_WIDTH - 2;
  let scroll: ScrollBoxRenderable | undefined;
  const title = (): string => {
    const total = view().total;
    return total === null ? " Miembros " : ` Miembros · ${formatCount(total)} `;
  };

  return (
    <box
      title={title()}
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
      <scrollbox
        ref={(el: ScrollBoxRenderable) => (scroll = el)}
        width="100%"
        flexGrow={1}
        onMouseScroll={(e: { scroll?: { direction: string } }) => {
          if (e.scroll?.direction !== "down" || !scroll) return;
          if (scroll.scrollTop + scroll.viewport.height >= scroll.scrollHeight - NEAR_END_ROWS) props.onNearEnd?.();
        }}
      >
        <For each={rows()}>
          {(row) =>
            row.kind === "group" ? (
              <box width="100%" marginTop={1}>
                <text fg={props.theme.dim} attributes={TextAttributes.BOLD} wrapMode="none">
                  {truncate(`${row.label.toUpperCase()} — ${row.count}`, inner)}
                </text>
              </box>
            ) : (
              <box flexDirection="row" width="100%" onMouseDown={() => props.onMember?.(row.userId)}>
                <text fg={presenceColor(props.theme, row.status)}>{row.status === "offline" ? " ○" : " ●"}</text>
                <Show when={row.avatar !== null}>
                  <text width={1}> </text>
                  <Avatar userId={row.userId} name={row.name} url={props.images ? row.avatar : null} theme={props.theme} />
                </Show>
                <text
                  wrapMode="none"
                  fg={
                    row.status === "offline"
                      ? props.theme.faint
                      : roleHex(row.color) ??
                        props.theme.names[hashIndex(row.userId, props.theme.names.length)]
                  }
                >
                  {` ${truncate(row.name, inner - 4 - (row.avatar !== null ? AVATAR_COLS + 1 : 0))}`}
                </text>
              </box>
            )
          }
        </For>
      </scrollbox>
    </box>
  );
}
