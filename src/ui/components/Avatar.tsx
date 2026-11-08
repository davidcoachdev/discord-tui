import type { BoxRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { createEffect, createSignal, Match, on, onCleanup, Switch, type JSX } from "solid-js";

import { AVATAR_COLS, avatarLoader, type AvatarImage, type AvatarLoader } from "../../images/avatar";
import { cellWidth, hashIndex } from "../format";
import type { Theme } from "../theme";
import { AnimatedImage, onScreen } from "./AnimatedImage";

/** Inicial del nombre en 2 celdas ("G " o un emoji/CJK de 2). */
export function avatarInitial(name: string): string {
  const first = [...new Intl.Segmenter().segment(name.trim())][0]?.segment ?? "?";
  const upper = first.toUpperCase();
  const w = cellWidth(upper);
  if (w === 2) return upper;
  return w === 1 ? `${upper} ` : "? ";
}

/**
 * Avatar de 2×1 celdas. Sin `url` (imágenes apagadas) o mientras carga o si falla: la inicial sobre un
 * color de la paleta de nombres. Mismo ancho en todos los estados. Pide la imagen recién la primera vez
 * que se dibuja en pantalla (un scrollbox no dibuja las filas que quedan fuera), y por la cola del loader.
 */
export function Avatar(props: { userId: string; name: string; url: string | null; theme: Theme; loader?: AvatarLoader }): JSX.Element {
  const renderer = useRenderer();
  const loader = (): AvatarLoader => props.loader ?? avatarLoader;
  const [image, setImage] = createSignal<AvatarImage | null>(props.url ? loader().peek(props.url) : null);
  let alive = true;
  let el: BoxRenderable | undefined;
  onCleanup(() => (alive = false));

  // Gancho de dibujo: solo mientras falta pedir la imagen (después se saca, no cuesta nada por cuadro).
  let lastUrl = props.url;
  createEffect(
    on(
      () => props.url,
      (url) => {
        if (url === lastUrl) return;
        lastUrl = url;
        setImage(url ? loader().peek(url) : null);
        if (el && !el.isDestroyed) el.renderBefore = url && !image() ? check : undefined;
      },
      { defer: true },
    ),
  );

  const check = (): void => {
    const url = props.url;
    queueMicrotask(() => {
      if (el && !el.isDestroyed && el.renderBefore === check && requested(url)) el.renderBefore = undefined;
    });
  };

  /** true si ya se resolvió o se pidió (y el gancho se puede sacar). */
  function requested(url: string | null): boolean {
    if (!alive || !el || !url || url !== props.url) return true;
    if (image()) return true;
    if (!onScreen(el, renderer.height)) return false;
    void loader()
      .get(url, () => alive && props.url === url)
      .then((result) => {
        if (alive && props.url === url) setImage(result);
      });
    return true;
  }

  const shown = (): AvatarImage | null => {
    const current = image();
    return props.url && current ? current : null;
  };
  const bg = (): string => props.theme.names[hashIndex(props.userId, props.theme.names.length)]!;

  return (
    <box
      ref={(node: BoxRenderable) => {
        el = node;
        if (props.url && !image()) node.renderBefore = check;
      }}
      width={AVATAR_COLS}
      height={1}
      flexShrink={0}
    >
      <Switch fallback={<text width={AVATAR_COLS} fg={props.theme.modeFg} bg={bg()} wrapMode="none">{avatarInitial(props.name)}</text>}>
        <Match when={shown()?.kind === "frames" && shown()} keyed>
          {(img: AvatarImage) => <AnimatedImage animation={(img as Extract<AvatarImage, { kind: "frames" }>).animation} cols={AVATAR_COLS} rows={1} />}
        </Match>
        <Match when={shown()?.kind === "bytes" && shown()} keyed>
          {(img: AvatarImage) => (
            <image source={(img as Extract<AvatarImage, { kind: "bytes" }>).bytes} width={AVATAR_COLS} height={1} fit="fit" protocol="auto" />
          )}
        </Match>
      </Switch>
    </box>
  );
}
