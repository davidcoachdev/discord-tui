import { TextAttributes } from "@opentui/core";
import { For, Show, type JSX } from "solid-js";

import { formatBytes } from "../../uploads/file";
import type { PendingAttachment } from "../../store/types";
import type { MentionCandidate } from "../mentions";
import type { Theme } from "../theme";
import { Button, type Click } from "./Button";

export function MentionPopup(props: {
  candidates: MentionCandidate[];
  index: number;
  theme: Theme;
  onPick?(index: number): void;
}): JSX.Element {
  return (
    <box
      border
      borderStyle="rounded"
      borderColor={props.theme.accent}
      title=" @ mencionar · Tab elige "
      titleColor={props.theme.accent}
      flexDirection="column"
      width={44}
      flexShrink={0}
    >
      <For each={props.candidates}>
        {(candidate, i) => (
          <box
            flexDirection="row"
            backgroundColor={i() === props.index ? props.theme.selection : undefined}
            onMouseDown={(e: Click) => {
              e.stopPropagation();
              props.onPick?.(i());
            }}
          >
            <text fg={i() === props.index ? props.theme.selectionFg : props.theme.fg} wrapMode="none">
              {` ${candidate.label}`}
            </text>
            <text fg={props.theme.dim} wrapMode="none">{candidate.secondary ? `  ${candidate.secondary}` : ""}</text>
          </box>
        )}
      </For>
    </box>
  );
}

export function Composer(props: {
  text: string;
  insert: boolean;
  replyTo: string | null;
  editing: string | null;
  theme: Theme;
  placeholder?: string;
  context?: string | null;
  attachments?: PendingAttachment[];
  prompt?: string | null;
  onClick?(): void;
  onAttach?(): void;
  onPaste?(): void;
  onRemoveAttachment?(index: number): void;
}): JSX.Element {
  const over = (): boolean => props.text.length > 2000;
  const counter = (): string => (over() ? ` ${props.text.length}/2000 · muy largo ` : ` ${props.text.length}/2000 `);
  const border = (): string => (props.insert ? props.theme.modeInsert : props.theme.border);

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={border()}
      title={props.prompt ? " adjuntar archivo " : props.editing ? " editando " : props.replyTo ? " respondiendo " : undefined}
      titleColor={props.theme.accent}
      bottomTitle={counter()}
      bottomTitleAlignment="right"
      width="100%"
      flexDirection="column"
      flexShrink={0}
      onMouseDown={() => props.onClick?.()}
    >
      <Show when={props.context}>
        <text fg={props.theme.accent} wrapMode="none">{`↪ ${props.context} · Esc cancela`}</text>
      </Show>
      <For each={props.attachments ?? []}>
        {(file, i) => (
          <box flexDirection="row" columnGap={1}>
            <text fg={props.theme.link} wrapMode="none">{`📎 ${file.filename} (${formatBytes(file.bytes.byteLength)}) · x quita`}</text>
            <Button label="✕" theme={props.theme} danger onPress={() => props.onRemoveAttachment?.(i())} />
          </box>
        )}
      </For>
      <box flexDirection="row" width="100%">
      <box flexGrow={1}>
      <Show
        when={props.prompt == null}
        fallback={
          <text wrapMode="char" fg={props.theme.fg}>
            <span style={{ fg: props.theme.accent }}>{"path ❯ "}</span>
            {props.prompt}
            <span style={{ fg: props.theme.modeInsert }}>█</span>
          </text>
        }
      >
        <Show
          when={props.text.length > 0 || props.insert}
          fallback={<text fg={props.theme.faint}>{`· ${props.placeholder ?? "i para escribir"}`}</text>}
        >
          <text wrapMode="char" fg={over() ? props.theme.error : props.theme.fg}>
            <span style={{ fg: props.insert ? props.theme.modeInsert : props.theme.dim, attributes: TextAttributes.BOLD }}>
              {props.insert ? "❯ " : "· "}
            </span>
            {props.text}
            <Show when={props.insert}>
              <span style={{ fg: props.theme.modeInsert }}>█</span>
            </Show>
          </text>
        </Show>
      </Show>
      </box>
      <Show when={props.onAttach || props.onPaste}>
        <box flexDirection="row" columnGap={1} flexShrink={0}>
          <Button label="📎 adjuntar" theme={props.theme} onPress={() => props.onAttach?.()} />
          <Button label="📋 pegar" theme={props.theme} onPress={() => props.onPaste?.()} />
        </box>
      </Show>
      </box>
    </box>
  );
}
