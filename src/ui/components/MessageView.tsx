import type { ScrollBoxRenderable } from "@opentui/core";
import { createEffect, For, on, Show, type JSX } from "solid-js";

import { selectMessages, selectOutbox, selectTyping } from "../../store/selectors";
import type { Store } from "../../store/store";
import type { AppState, Message, OutboxItem } from "../../store/types";
import { dayLabel, displayName, sameDay, truncate, typingText } from "../format";
import { useSelector } from "../store-bridge";
import type { Theme } from "../theme";
import { MessageItem } from "./MessageItem";

const GROUP_WINDOW_MS = 7 * 60_000;

export function channelTitle(state: AppState): string {
  const id = state.ui.selectedChannelId;
  const channel = id ? state.channels[id] : undefined;
  if (!channel) return "Mensajes";
  if (channel.guildId === null) return channel.type === 3 ? `👥 ${channel.name}` : `@ ${channel.name}`;
  const guild = state.guilds[channel.guildId]?.name;
  const icon = channel.type === 2 ? "🔊" : "#";
  return `${icon} ${channel.name}${guild ? `  ·  ${guild}` : ""}`;
}

export function MessageView(props: {
  store: Store;
  theme: Theme;
  selectedId?: string | null;
  focused?: boolean;
  images?: boolean;
}): JSX.Element {
  const state = useSelector(props.store, (s) => s);
  const channelId = (): string | null => state().ui.selectedChannelId;
  const messages = (): Message[] => (channelId() === null ? [] : selectMessages(state(), channelId()!));
  const outbox = (): OutboxItem[] => (channelId() === null ? [] : selectOutbox(state(), channelId()!));
  const guildId = (): string | null => (channelId() ? state().channels[channelId()!]?.guildId ?? null : null);
  const slice = () => (channelId() ? state().messages[channelId()!] : undefined);
  const typing = (): string | null =>
    channelId() === null
      ? null
      : typingText(selectTyping(state(), channelId()!, Date.now()).map((id) => displayName(state(), id, guildId())));

  let scroll: ScrollBoxRenderable | undefined;

  createEffect(
    on(
      () => props.selectedId,
      (id) => {
        if (!scroll) return;
        if (id) {
          scroll.stickyScroll = false;
          try {
            scroll.scrollChildIntoView(`msg-${id}`);
          } catch {
            // todavía no está en el layout
          }
        } else {
          scroll.stickyScroll = true;
          scroll.scrollTo(Infinity);
        }
      },
    ),
  );

  createEffect(
    on(channelId, () => {
      if (!scroll) return;
      scroll.stickyScroll = true;
      scroll.scrollTo(Infinity);
    }),
  );

  const isGrouped = (message: Message, index: number): boolean => {
    if (index === 0) return false;
    const previous = messages()[index - 1];
    if (!previous || previous.authorId !== message.authorId || message.referenced !== null) return false;
    if (!sameDay(previous.timestamp, message.timestamp)) return false;
    return Math.abs(new Date(message.timestamp).getTime() - new Date(previous.timestamp).getTime()) < GROUP_WINDOW_MS;
  };

  const daySeparator = (message: Message, index: number): string | null => {
    const previous = index === 0 ? null : messages()[index - 1];
    if (previous && sameDay(previous.timestamp, message.timestamp)) return null;
    return dayLabel(message.timestamp);
  };

  const isText = (): boolean => {
    const type = channelId() ? state().channels[channelId()!]?.type : undefined;
    return type !== 2 && type !== 4;
  };

  return (
    <box
      title={` ${truncate(channelTitle(state()), 60)} `}
      titleColor={props.focused ? props.theme.borderFocus : props.theme.header}
      border
      borderStyle="rounded"
      borderColor={props.focused ? props.theme.borderFocus : props.theme.border}
      flexGrow={1}
      height="100%"
      flexDirection="column"
    >
      <Show
        when={channelId() !== null && isText()}
        fallback={
          <box flexGrow={1} justifyContent="center" alignItems="center" flexDirection="column">
            <text fg={props.theme.dim}>
              {channelId() !== null ? "Canal de voz: apretá v para entrar o salir" : "Elegí un canal con j/k y l (o Ctrl-k)"}
            </text>
          </box>
        }
      >
        <scrollbox ref={(el: ScrollBoxRenderable) => (scroll = el)} width="100%" flexGrow={1} stickyScroll stickyStart="bottom">
          <Show when={slice()?.loadingOlder}>
            <text fg={props.theme.dim}>  cargando mensajes anteriores…</text>
          </Show>
          <Show when={slice() && !slice()!.hasMoreBefore && messages().length > 0}>
            <text fg={props.theme.dim}>  ── principio del canal ──</text>
          </Show>
          <Show when={slice() === undefined}>
            <text fg={props.theme.dim}>  cargando…</text>
          </Show>
          <Show when={slice() !== undefined && messages().length === 0 && !slice()!.loadingOlder}>
            <text fg={props.theme.dim}>  todavía no hay mensajes acá · i para escribir el primero</text>
          </Show>
          <For each={messages()}>
            {(message, index) => (
              <>
                <Show when={daySeparator(message, index())}>
                  <box width="100%" justifyContent="center" flexDirection="row" marginTop={1}>
                    <text fg={props.theme.dim}>{`──── ${daySeparator(message, index())} ────`}</text>
                  </box>
                </Show>
                <MessageItem
                  message={message}
                  state={state()}
                  theme={props.theme}
                  guildId={guildId()}
                  grouped={isGrouped(message, index())}
                  selected={props.selectedId === message.id}
                  images={props.images}
                />
              </>
            )}
          </For>
          <For each={outbox()}>
            {(item) => (
              <box flexDirection="row" paddingLeft={1} marginTop={1}>
                <text wrapMode="word" fg={item.state === "failed" ? props.theme.error : props.theme.dim}>
                  {item.state === "failed"
                    ? `✗ no se envió (${item.error ?? "error"}) · R reintenta: ${truncate(item.content, 60)}`
                    : `◌ enviando… ${truncate(item.content, 60)}`}
                </text>
              </box>
            )}
          </For>
        </scrollbox>
      </Show>
      <box height={1} width="100%" paddingLeft={1}>
        <text fg={props.theme.dim} wrapMode="none">{typing() ?? ""}</text>
      </box>
    </box>
  );
}
