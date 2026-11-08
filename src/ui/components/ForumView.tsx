import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { createEffect, createSignal, For, on, Show, type JSX } from "solid-js";

import { selectForumPosts, type ForumPostRow } from "../../store/selectors";
import type { Store } from "../../store/store";
import { truncate } from "../format";
import { jsonEqual, useSelector } from "../store-bridge";
import type { Theme } from "../theme";
import { Button } from "./Button";

/** Un foro (o canal de medios): sus posts, el más activo arriba; click o Enter abre uno. */
export function ForumView(props: {
  store: Store;
  theme: Theme;
  forumId: string;
  selectedId?: string | null;
  onOpenPost?(postId: string): void;
  onLoadArchived?(forumId: string): void;
}): JSX.Element {
  const posts = useSelector(props.store, (s) => selectForumPosts(s, props.forumId), jsonEqual);
  const [hovered, setHovered] = createSignal<string | null>(null);
  let scroll: ScrollBoxRenderable | undefined;

  createEffect(
    on(
      () => props.selectedId,
      (id) => {
        try {
          if (id) scroll?.scrollChildIntoView(`post-${id}`);
        } catch {
          // todavía no está en el layout
        }
      },
    ),
  );

  const meta = (post: ForumPostRow): string => {
    const parts: string[] = [];
    if (post.messageCount !== null) parts.push(`${post.messageCount} ${post.messageCount === 1 ? "mensaje" : "mensajes"}`);
    if (post.locked) parts.push("🔒");
    if (post.archived) parts.push("archivado");
    return parts.join(" · ");
  };

  return (
    <box flexDirection="column" width="100%" flexGrow={1}>
      <scrollbox ref={(el: ScrollBoxRenderable) => (scroll = el)} width="100%" flexGrow={1}>
        <Show when={posts().length === 0}>
          <text fg={props.theme.dim}>  no hay posts activos en este foro</text>
        </Show>
        <For each={posts()}>
          {(post) => {
            const isSel = (): boolean => props.selectedId === post.id;
            return (
              <box
                id={`post-${post.id}`}
                flexDirection="column"
                width="100%"
                paddingLeft={1}
                marginTop={1}
                backgroundColor={isSel() ? props.theme.selection : hovered() === post.id ? props.theme.panel : undefined}
                onMouseDown={(e: { stopPropagation(): void }) => {
                  e.stopPropagation();
                  props.onOpenPost?.(post.id);
                }}
                onMouseOver={() => setHovered(post.id)}
                onMouseOut={() => setHovered((h) => (h === post.id ? null : h))}
              >
                <text
                  wrapMode="none"
                  fg={isSel() ? props.theme.selectionFg : post.unread ? props.theme.unread : props.theme.fg}
                  attributes={post.unread || isSel() ? TextAttributes.BOLD : 0}
                >
                  {`🧵 ${truncate(post.name, 90)}`}
                </text>
                <text wrapMode="none" fg={props.theme.dim}>{`   ${meta(post)}`}</text>
              </box>
            );
          }}
        </For>
        <box flexDirection="row" paddingLeft={1} marginTop={1}>
          <Button label="⟳ cargar posts archivados" theme={props.theme} onPress={() => props.onLoadArchived?.(props.forumId)} />
        </box>
      </scrollbox>
      <box height={1} width="100%" paddingLeft={1}>
        <text fg={props.theme.faint} wrapMode="none">j/k elige · Enter o click abre · a trae los archivados</text>
      </box>
    </box>
  );
}
