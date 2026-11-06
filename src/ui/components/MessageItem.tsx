import { Show, type JSX } from "solid-js";

import type { Message } from "../../store/types";

function clockTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toTimeString().slice(0, 5);
}

export function MessageItem(props: { message: Message; author: string; grouped: boolean }): JSX.Element {
  return (
    <box flexDirection="column">
      <Show when={props.message.referenced}>
        <text>{`↳ ${props.author}: ${(props.message.referenced?.content ?? "").slice(0, 60)}`}</text>
      </Show>
      <Show when={!props.grouped}>
        <text>{`${clockTime(props.message.timestamp)} ${props.author}`}</text>
      </Show>
      <text>{`${props.message.content}${props.message.editedTimestamp ? " (editado)" : ""}`}</text>
    </box>
  );
}
