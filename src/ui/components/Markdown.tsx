import { TextAttributes } from "@opentui/core";
import { For, Show, type JSX } from "solid-js";

import { formatTimestamp, type MdNode } from "../../markdown/parse";
import type { AppState } from "../../store/types";
import { displayName } from "../format";
import type { Theme } from "../theme";

export const CODEBLOCK_MAX_LINES = 20;

type Block =
  | { kind: "inline"; nodes: MdNode[] }
  | { kind: "code"; lang: string | null; text: string }
  | { kind: "quote"; nodes: MdNode[] };

export function toBlocks(nodes: MdNode[]): Block[] {
  const blocks: Block[] = [];
  let inline: MdNode[] = [];
  const flush = (): void => {
    // Saca los saltos de línea que quedan pegados a un bloque.
    if (inline.length > 0) {
      const first = inline[0]!;
      if (first.type === "text") inline[0] = { type: "text", text: first.text.replace(/^\n/, "") };
      const last = inline[inline.length - 1]!;
      if (last.type === "text") inline[inline.length - 1] = { type: "text", text: last.text.replace(/\n$/, "") };
      const empty = inline.every((node) => node.type === "text" && node.text.length === 0);
      if (!empty) blocks.push({ kind: "inline", nodes: inline });
    }
    inline = [];
  };
  for (const node of nodes) {
    if (node.type === "codeblock") {
      flush();
      blocks.push({ kind: "code", lang: node.lang, text: node.text });
    } else if (node.type === "quote") {
      flush();
      blocks.push({ kind: "quote", nodes: node.children });
    } else inline.push(node);
  }
  flush();
  return blocks;
}

export interface MdContext {
  state: AppState;
  theme: Theme;
  guildId: string | null;
  revealSpoilers: boolean;
}

function renderInline(nodes: MdNode[], ctx: MdContext): JSX.Element[] {
  const { theme, state } = ctx;
  return nodes.map((node): JSX.Element => {
    switch (node.type) {
      case "text":
        return node.text;
      case "bold":
        return <b>{renderInline(node.children, ctx)}</b>;
      case "italic":
        return <i>{renderInline(node.children, ctx)}</i>;
      case "underline":
        return <u>{renderInline(node.children, ctx)}</u>;
      case "strike":
        return <span style={{ attributes: TextAttributes.STRIKETHROUGH }}>{renderInline(node.children, ctx)}</span>;
      case "spoiler":
        return ctx.revealSpoilers ? (
          <span style={{ bg: theme.faint }}>{renderInline(node.children, ctx)}</span>
        ) : (
          <span style={{ fg: theme.faint, bg: theme.faint }}>{renderInline(node.children, ctx)}</span>
        );
      case "quote":
        return renderInline(node.children, ctx) as unknown as JSX.Element;
      case "code":
        return <span style={{ fg: theme.codeFg, bg: theme.codeBg }}>{` ${node.text} `}</span>;
      case "codeblock":
        return <span style={{ fg: theme.codeFg, bg: theme.codeBg }}>{node.text}</span>;
      case "mention": {
        let label: string;
        if (node.kind === "everyone" || node.kind === "here") label = `@${node.kind}`;
        else if (node.kind === "user") label = `@${node.id ? displayName(state, node.id, ctx.guildId) : "usuario"}`;
        else if (node.kind === "channel") label = `#${(node.id && state.channels[node.id]?.name) || "canal"}`;
        else {
          const role = ctx.guildId ? state.guilds[ctx.guildId]?.roles.find((r) => r.id === node.id) : undefined;
          label = `@${role?.name ?? "rol"}`;
        }
        return <span style={{ fg: theme.mentionFg, bg: theme.mentionBg }}>{label}</span>;
      }
      case "emoji":
        return <span style={{ fg: theme.mention }}>{`:${node.name}:`}</span>;
      case "link":
        return (
          <a href={node.url} style={{ fg: theme.link, attributes: TextAttributes.UNDERLINE }}>
            {node.label ?? node.url}
          </a>
        );
      case "timestamp":
        return <span style={{ fg: theme.accent, bg: theme.codeBg }}>{formatTimestamp(node.unix, node.style)}</span>;
      default:
        return "";
    }
  });
}

export function Markdown(props: { nodes: MdNode[]; ctx: MdContext; suffix?: JSX.Element }): JSX.Element {
  const blocks = (): Block[] => toBlocks(props.nodes);
  return (
    <box flexDirection="column" width="100%">
      <For each={blocks()}>
        {(block, index) => {
          const last = (): boolean => index() === blocks().length - 1;
          if (block.kind === "code") {
            const lines = block.text.split("\n");
            const shown = lines.slice(0, CODEBLOCK_MAX_LINES);
            const hidden = lines.length - shown.length;
            return (
              <box flexDirection="column" backgroundColor={props.ctx.theme.codeBg} paddingLeft={1} paddingRight={1} width="100%">
                <Show when={block.lang}>
                  <text fg={props.ctx.theme.dim}>{block.lang}</text>
                </Show>
                <For each={shown}>{(line) => <text fg={props.ctx.theme.codeFg} wrapMode="char">{line || " "}</text>}</For>
                <Show when={hidden > 0}>
                  <text fg={props.ctx.theme.dim}>{`… (${hidden} líneas más)`}</text>
                </Show>
              </box>
            );
          }
          if (block.kind === "quote") {
            return (
              <box flexDirection="row" width="100%">
                <text fg={props.ctx.theme.quote}>▎ </text>
                <text fg={props.ctx.theme.dim} wrapMode="word" flexGrow={1}>
                  {renderInline(block.nodes, props.ctx)}
                </text>
              </box>
            );
          }
          return (
            <text fg={props.ctx.theme.fg} wrapMode="word" width="100%">
              {renderInline(block.nodes, props.ctx)}
              {last() ? props.suffix : null}
            </text>
          );
        }}
      </For>
      <Show when={blocks().length === 0 && props.suffix}>
        <text>{props.suffix}</text>
      </Show>
    </box>
  );
}
