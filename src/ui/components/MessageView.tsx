import { For, type JSX } from "solid-js";

import { selectMessages, selectOutbox } from "../../store/selectors";
import type { Store } from "../../store/store";
import type { Message } from "../../store/types";
import { useSelector } from "../store-bridge";
import { MessageItem } from "./MessageItem";

const GROUP_WINDOW_MS = 7 * 60_000;

export function MessageView(props: { store: Store }): JSX.Element {
  const messages = useSelector(props.store, (state) =>
    state.ui.selectedChannelId === null ? [] : selectMessages(state, state.ui.selectedChannelId),
  );
  const outbox = useSelector(props.store, (state) =>
    state.ui.selectedChannelId === null ? [] : selectOutbox(state, state.ui.selectedChannelId),
  );

  const authorName = (id: string): string => {
    const user = props.store.getState().users[id];
    return user?.globalName ?? user?.username ?? id;
  };

  const isGrouped = (message: Message, index: number): boolean => {
    if (index === 0) return false;
    const previous = messages()[index - 1];
    if (!previous || previous.authorId !== message.authorId || message.referenced !== null) return false;
    return Math.abs(new Date(message.timestamp).getTime() - new Date(previous.timestamp).getTime()) < GROUP_WINDOW_MS;
  };

  return (
    <box title="Mensajes" border flexGrow={1} height="100%">
      <scrollbox width="100%" height="100%" stickyScroll stickyStart="bottom">
        <For each={outbox()}>
          {(item) => (
            <text>
              {item.state === "failed" ? `✗ no se envió · R reintenta (${item.content.slice(0, 40)})` : `… ${item.content.slice(0, 40)}`}
            </text>
          )}
        </For>
        <For each={messages()}>
          {(message, index) => (
            <MessageItem message={message} author={authorName(message.authorId)} grouped={isGrouped(message, index())} />
          )}
        </For>
      </scrollbox>
    </box>
  );
}
