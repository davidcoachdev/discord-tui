import { TextAttributes } from "@opentui/core";
import { For, Show, type JSX } from "solid-js";

import { truncate } from "../format";
import type { SwitcherItem } from "../fuzzy";
import { listWindow } from "../list-window";
import type { Theme } from "../theme";
import type { Click } from "./Button";

export const SWITCHER_ROWS = 12;

export function QuickSwitcher(props: {
  query: string;
  items: SwitcherItem[];
  index: number;
  theme: Theme;
  onPick?(index: number): void;
  onMove?(index: number): void;
  onClose?(): void;
}): JSX.Element {
  const view = () => listWindow(props.index, props.items.length, SWITCHER_ROWS);
  const visible = () => props.items.slice(view().start, view().end).map((item, i) => ({ item, at: view().start + i }));
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      paddingTop={3}
      alignItems="center"
      zIndex={50}
      onMouseDown={() => props.onClose?.()}
    >
      <box
        onMouseDown={(e: Click) => e.stopPropagation()}
        onMouseScroll={(e: { scroll?: { direction: string; delta?: number }; stopPropagation(): void }) => {
          e.stopPropagation();
          // OpenTUI junta las vueltas rápidas de la rueda en un evento con `delta` > 1.
        const steps = Math.max(1, Math.round(Math.abs(e.scroll?.delta ?? 1)));
        const delta = e.scroll?.direction === "down" ? steps : e.scroll?.direction === "up" ? -steps : 0;
          if (delta !== 0 && props.items.length > 0) {
            props.onMove?.(Math.max(0, Math.min(props.items.length - 1, props.index + delta)));
          }
        }}
        border
        borderStyle="rounded"
        borderColor={props.theme.accent}
        backgroundColor={props.theme.panel}
        title=" Saltar a… "
        titleColor={props.theme.accent}
        bottomTitle={` ${props.items.length > 0 ? `${props.index + 1}/${props.items.length} · ` : ""}↑↓ rueda · Enter abre · Esc cierra `}
        bottomTitleAlignment="right"
        width={64}
        flexDirection="column"
      >
        <text fg={props.theme.fg}>
          <span style={{ fg: props.theme.accent, attributes: TextAttributes.BOLD }}>{"❯ "}</span>
          {props.query}
          <span style={{ fg: props.theme.modeInsert }}>█</span>
        </text>
        <box height={1}>
          <text fg={props.theme.faint}>{"─".repeat(62)}</text>
        </box>
        <Show when={props.items.length === 0}>
          <text fg={props.theme.dim}> sin resultados</text>
        </Show>
        <Show when={view().start > 0}>
          <text fg={props.theme.faint}>{`   ↑ ${view().start} más`}</text>
        </Show>
        <For each={visible()}>
          {(row) => (
            <box
              flexDirection="row"
              backgroundColor={row.at === props.index ? props.theme.selection : undefined}
              onMouseDown={(e: Click) => {
                e.stopPropagation();
                props.onPick?.(row.at);
              }}
            >
              <text
                fg={row.at === props.index ? props.theme.selectionFg : row.item.unread ? props.theme.unread : props.theme.dim}
                attributes={row.item.unread ? TextAttributes.BOLD : 0}
                wrapMode="none"
              >
                {` ${truncate(row.item.label, 56)}${row.item.unread ? "  •" : ""}`}
              </text>
            </box>
          )}
        </For>
        <Show when={view().end < props.items.length}>
          <text fg={props.theme.faint}>{`   ↓ ${props.items.length - view().end} más`}</text>
        </Show>
      </box>
    </box>
  );
}
