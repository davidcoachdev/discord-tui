import { TextAttributes } from "@opentui/core";
import { createResource, createSignal, For, Show, type JSX } from "solid-js";

export type MessageAction = "reply" | "edit" | "delete" | "react";

import { attachmentView, sizedUrl } from "../../images/cdn";
import { imageCache } from "../../images/cache";
import { IMAGE_MODE } from "../../images/mode";
import { parseMarkdown, plainText } from "../../markdown/parse";
import type { ApiEmbed, AppState, Message } from "../../store/types";
import { clockTime, displayName, hashIndex, memberColor, truncate } from "../format";
import { roleHex, type Theme } from "../theme";
import { Button, type Click } from "./Button";
import { Markdown, type MdContext } from "./Markdown";

function authorColor(state: AppState, theme: Theme, userId: string, guildId: string | null): string {
  return roleHex(memberColor(state, userId, guildId)) ?? theme.names[hashIndex(userId, theme.names.length)]!;
}

function InlineImage(props: { url: string; cols: number; rows: number; label: string; theme: Theme }): JSX.Element {
  const [bytes] = createResource(
    () => sizedUrl(props.url, props.cols, props.rows),
    (url) => imageCache.get(url),
  );
  return (
    <Show when={bytes()} fallback={<text fg={props.theme.dim}>{props.label}</text>}>
      {(data: () => Uint8Array) => <image source={data()} width={props.cols} height={props.rows} fit="fit" protocol="auto" />}
    </Show>
  );
}


function EmbedView(props: { embed: ApiEmbed; ctx: MdContext; images: boolean; onOpen?(url: string): void }): JSX.Element {
  const theme = props.ctx.theme;
  const bar = (): string => roleHex(props.embed.color ?? 0) ?? theme.border;
  const description = (): string => {
    const lines = (props.embed.description ?? "").split("\n");
    return lines.length > 6 ? `${lines.slice(0, 6).join("\n")}\n…` : lines.join("\n");
  };
  const image = (): { url: string; width?: number; height?: number } | undefined =>
    (props.embed.image ?? props.embed.thumbnail) as { url: string; width?: number; height?: number } | undefined;
  return (
    <box flexDirection="row" width="100%" marginTop={0}>
      <text fg={bar()}>▌</text>
      <box flexDirection="column" flexGrow={1} paddingLeft={1}>
        <Show when={props.embed.provider?.name}>
          <text fg={theme.dim}>{props.embed.provider?.name}</text>
        </Show>
        <Show when={props.embed.author?.name}>
          <text fg={theme.fg} attributes={TextAttributes.BOLD}>{props.embed.author?.name}</text>
        </Show>
        <Show when={props.embed.title}>
          <text
            fg={props.embed.url ? theme.link : theme.fg}
            attributes={TextAttributes.BOLD}
            wrapMode="word"
            onMouseDown={(e: Click) => {
              if (!props.embed.url) return;
              e.stopPropagation();
              props.onOpen?.(props.embed.url);
            }}
          >
            {props.embed.title}
          </text>
        </Show>
        <Show when={props.embed.description}>
          <Markdown nodes={parseMarkdown(description())} ctx={props.ctx} />
        </Show>
        <Show when={image()}>
          {(img: () => { url: string; width?: number; height?: number }) => {
            const view = attachmentView(
              {
                filename: "imagen",
                size: 0,
                url: img().url,
                proxy_url: (img() as { proxy_url?: string }).proxy_url ?? img().url,
                content_type: "image/png",
                width: img().width,
                height: img().height,
              },
              props.images ? IMAGE_MODE : "links",
            );
            return view.kind === "image" ? (
              <InlineImage url={view.url} cols={Math.min(view.cols, 30)} rows={Math.min(view.rows, 8)} label="🖼 imagen" theme={theme} />
            ) : null;
          }}
        </Show>
      </box>
    </box>
  );
}

export function MessageItem(props: {
  message: Message;
  state: AppState;
  theme: Theme;
  guildId: string | null;
  grouped: boolean;
  selected?: boolean;
  images?: boolean;
  onSelect?(): void;
  onAction?(action: MessageAction): void;
  onReact?(emoji: { id: string | null; name: string }): void;
  onOpen?(url: string): void;
}): JSX.Element {
  const theme = (): Theme => props.theme;
  const [hover, setHover] = createSignal(false);
  const mine = (): boolean => props.message.authorId === props.state.me?.id;
  const ctx = (): MdContext => ({ state: props.state, theme: props.theme, guildId: props.guildId, revealSpoilers: props.selected === true });
  const author = (): string => displayName(props.state, props.message.authorId, props.guildId);
  const nodes = () => parseMarkdown(props.message.content);
  const bg = (): string | undefined => (props.selected ? props.theme.selection : hover() ? props.theme.panel : undefined);
  const gutter = (): string => (props.selected ? props.theme.accent : props.message.mentionsMe ? props.theme.mention : "");

  const referenced = (): string | null => {
    const ref = props.message.referenced;
    if (!ref) return null;
    const who = ref.authorId ? displayName(props.state, ref.authorId, props.guildId) : "mensaje";
    const text = plainText(parseMarkdown(ref.content), {
      user: (id) => displayName(props.state, id, props.guildId),
      channel: (id) => props.state.channels[id]?.name ?? "canal",
    });
    return `╭─ @${who} ${truncate(text || "(adjunto)", 60)}`;
  };

  return (
    <box
      id={`msg-${props.message.id}`}
      flexDirection="row"
      width="100%"
      backgroundColor={bg()}
      marginTop={props.grouped ? 0 : 1}
      onMouseDown={() => props.onSelect?.()}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
    >
      <text fg={gutter() || props.theme.bg} width={1}>{gutter() ? "▌" : " "}</text>
      <box flexDirection="column" flexGrow={1} paddingRight={1}>
        <Show when={referenced()}>
          <text fg={theme().dim} wrapMode="none">{referenced()}</text>
        </Show>
        <Show when={!props.grouped}>
          <text wrapMode="none">
            <b>
              <span style={{ fg: authorColor(props.state, props.theme, props.message.authorId, props.guildId) }}>{author()}</span>
            </b>
            <Show when={props.state.users[props.message.authorId]?.bot}>
              <span style={{ fg: props.theme.modeFg, bg: props.theme.accent }}>{" BOT "}</span>
            </Show>
            <span style={{ fg: theme().dim }}>{`  ${clockTime(props.message.timestamp)}`}</span>
          </text>
        </Show>
        <Markdown
          nodes={nodes()}
          ctx={ctx()}
          suffix={props.message.editedTimestamp ? <span style={{ fg: theme().dim }}> (editado)</span> : undefined}
        />
        <For each={props.message.attachments}>
          {(attachment) => {
            const view = attachmentView(attachment, props.images ? IMAGE_MODE : "links");
            const openIt = (e: Click): void => {
              e.stopPropagation();
              props.onOpen?.(attachment.url);
            };
            return view.kind === "image" ? (
              <box onMouseDown={openIt}>
                <InlineImage url={view.url} cols={view.cols} rows={view.rows} label={view.label} theme={props.theme} />
              </box>
            ) : (
              <text wrapMode="none" onMouseDown={openIt}>
                <a href={view.url} style={{ fg: theme().link }}>
                  {view.label}
                </a>
              </text>
            );
          }}
        </For>
        <For each={props.message.embeds.filter((embed) => embed.title || embed.description || embed.image || embed.thumbnail)}>
          {(embed) => <EmbedView embed={embed} ctx={ctx()} images={props.images === true} onOpen={props.onOpen} />}
        </For>
        <Show when={props.message.reactions.length > 0}>
          <box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <For each={props.message.reactions}>
              {(reaction) => (
                <text
                  fg={reaction.me ? theme().mentionFg : theme().fg}
                  bg={reaction.me ? theme().mentionBg : theme().selection}
                  onMouseDown={(e: Click) => {
                    e.stopPropagation();
                    props.onReact?.(reaction.emoji);
                  }}
                >
                  {` ${reaction.emoji.id ? `:${reaction.emoji.name}:` : reaction.emoji.name} ${reaction.count} `}
                </text>
              )}
            </For>
          </box>
        </Show>
        <Show when={props.selected && props.onAction}>
          <box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={0}>
            <Button label="↩ responder" theme={props.theme} onPress={() => props.onAction?.("reply")} />
            <Show when={mine()}>
              <Button label="✎ editar" theme={props.theme} onPress={() => props.onAction?.("edit")} />
              <Button label="🗑 borrar" theme={props.theme} danger onPress={() => props.onAction?.("delete")} />
            </Show>
            <Button label="😀 reaccionar" theme={props.theme} onPress={() => props.onAction?.("react")} />
          </box>
        </Show>
      </box>
    </box>
  );
}
