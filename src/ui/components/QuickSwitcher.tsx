import { TextAttributes } from "@opentui/core";
import { For, Show, type JSX } from "solid-js";

import { truncate } from "../format";
import type { SwitcherItem } from "../fuzzy";
import type { Theme } from "../theme";
import type { Click } from "./Button";

export function QuickSwitcher(props: {
  query: string;
  items: SwitcherItem[];
  index: number;
  theme: Theme;
  onPick?(index: number): void;
  onClose?(): void;
}): JSX.Element {
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
        border
        borderStyle="rounded"
        borderColor={props.theme.accent}
        backgroundColor={props.theme.panel}
        title=" Saltar a… "
        titleColor={props.theme.accent}
        bottomTitle=" ↑↓ o Ctrl-n/p · Enter abre · Esc cierra "
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
        <For each={props.items.slice(0, 12)}>
          {(item, i) => (
            <box
              flexDirection="row"
              backgroundColor={i() === props.index ? props.theme.selection : undefined}
              onMouseDown={(e: Click) => {
                e.stopPropagation();
                props.onPick?.(i());
              }}
            >
              <text
                fg={i() === props.index ? props.theme.selectionFg : item.unread ? props.theme.unread : props.theme.dim}
                attributes={item.unread ? TextAttributes.BOLD : 0}
                wrapMode="none"
              >
                {` ${truncate(item.label, item.unread ? 56 : 59)}${item.unread ? "  •" : ""}`}
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
  );
}
