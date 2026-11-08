import { TextAttributes } from "@opentui/core";
import { For, Show, type JSX } from "solid-js";

import { listWindow } from "../list-window";
import type { Theme } from "../theme";
import type { Click } from "./Button";

export interface EmojiChoice {
  name: string;
  char: string;
  id: string | null;
}

export const PICKER_ROWS = 8;

/** Selector de reacción: escribís para filtrar, ↑↓/rueda para elegir, Enter o click reacciona. */
export function EmojiPicker(props: {
  query: string;
  matches: EmojiChoice[];
  index: number;
  theme: Theme;
  onPick(index: number): void;
  onMove(index: number): void;
  onClose(): void;
}): JSX.Element {
  const view = () => listWindow(props.index, props.matches.length, PICKER_ROWS);
  const visible = () => props.matches.slice(view().start, view().end).map((emoji, i) => ({ emoji, at: view().start + i }));
  return (
    <box
      border
      borderStyle="rounded"
      borderColor={props.theme.accent}
      backgroundColor={props.theme.panel}
      title=" reaccionar · escribí para buscar "
      titleColor={props.theme.accent}
      bottomTitle={` ${props.matches.length > 0 ? `${props.index + 1}/${props.matches.length} · ` : ""}↑↓ rueda · Enter · Esc `}
      bottomTitleAlignment="right"
      flexDirection="column"
      width={48}
      flexShrink={0}
      onMouseScroll={(e: { scroll?: { direction: string; delta?: number }; stopPropagation(): void }) => {
        e.stopPropagation();
        // OpenTUI junta las vueltas rápidas de la rueda en un evento con `delta` > 1.
        const steps = Math.max(1, Math.round(Math.abs(e.scroll?.delta ?? 1)));
        const delta = e.scroll?.direction === "down" ? steps : e.scroll?.direction === "up" ? -steps : 0;
        if (delta !== 0 && props.matches.length > 0) {
          props.onMove(Math.max(0, Math.min(props.matches.length - 1, props.index + delta)));
        }
      }}
    >
      <box flexDirection="row">
        <text flexGrow={1} fg={props.theme.fg}>
          <span style={{ fg: props.theme.accent, attributes: TextAttributes.BOLD }}>{"❯ "}</span>
          {props.query}
          <span style={{ fg: props.theme.modeInsert }}>█</span>
        </text>
        <text
          fg={props.theme.dim}
          onMouseDown={(e: Click) => {
            e.stopPropagation();
            props.onClose();
          }}
        >
          {" ✕ "}
        </text>
      </box>
      <Show when={props.matches.length === 0}>
        <text fg={props.theme.dim}> ningún emoji con ese nombre</text>
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
              props.onPick(row.at);
            }}
          >
            <text fg={row.at === props.index ? props.theme.selectionFg : props.theme.fg} wrapMode="none">
              {` ${row.emoji.char}  ${row.emoji.name}${row.emoji.id ? "  (del servidor)" : ""}`}
            </text>
          </box>
        )}
      </For>
      <Show when={view().end < props.matches.length}>
        <text fg={props.theme.faint}>{`   ↓ ${props.matches.length - view().end} más`}</text>
      </Show>
    </box>
  );
}
