import { TextAttributes } from "@opentui/core";
import { For, Show, type JSX } from "solid-js";

import { formatBytes } from "../../uploads/file";
import type { PendingAttachment } from "../../store/types";
import type { MentionCandidate } from "../mentions";
import type { Theme } from "../theme";

export function MentionPopup(props: { candidates: MentionCandidate[]; index: number; theme: Theme }): JSX.Element {
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
          <box flexDirection="row" backgroundColor={i() === props.index ? props.theme.selection : undefined}>
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
    >
      <Show when={props.context}>
        <text fg={props.theme.accent} wrapMode="none">{`↪ ${props.context} · Esc cancela`}</text>
      </Show>
      <For each={props.attachments ?? []}>
        {(file) => (
          <text fg={props.theme.link} wrapMode="none">{`📎 ${file.filename} (${formatBytes(file.bytes.byteLength)}) · x quita`}</text>
        )}
      </For>
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
  );
}
