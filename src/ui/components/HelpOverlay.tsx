import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { createEffect, For, on, type JSX } from "solid-js";

import { keysByGroup } from "../keys";
import type { Theme } from "../theme";
import type { Click } from "./Button";

export function HelpOverlay(props: {
  onClose(): void;
  theme?: Theme;
  /** Acumulado de filas pedidas con el teclado (j/k, PgUp/PgDn); cada cambio scrollea la diferencia. */
  scroll?: number;
  /** Alto de la terminal: la ayuda no pasa de ahí y el resto se scrollea. */
  height?: number;
}): JSX.Element {
  const groups = [...keysByGroup().entries()];
  const accent = (): string | undefined => props.theme?.accent;
  let scroll: ScrollBoxRenderable | undefined;
  createEffect(
    on(
      () => props.scroll ?? 0,
      (now, before) => {
        if (!scroll || before === undefined) return;
        const delta = now - before;
        if (delta < -1e5) scroll.scrollTo(0);
        else scroll.scrollBy(delta);
      },
    ),
  );
  return (
    <box
      position="absolute"
      top={1}
      left={0}
      width="100%"
      height="100%"
      alignItems="center"
      zIndex={60}
      onMouseDown={() => props.onClose()}
    >
      <box
        onMouseDown={(e: Click) => e.stopPropagation()}
        border
        borderStyle="rounded"
        borderColor={accent()}
        backgroundColor={props.theme?.panel}
        title=" Ayuda · ? o Esc cierra · click afuera cierra "
        titleColor={accent()}
        bottomTitle=" j/k ↑↓ PgUp/PgDn rueda: desplazar "
        bottomTitleAlignment="right"
        width={96}
        maxHeight={Math.max(8, (props.height ?? 50) - 3)}
        flexDirection="column"
      >
      <scrollbox ref={(el: ScrollBoxRenderable) => (scroll = el)} width="100%" flexGrow={1} flexShrink={1}>
      <box flexDirection="row" flexWrap="wrap" padding={1} columnGap={3} width="100%">
        <For each={groups}>
          {([group, entries]) => (
            <box flexDirection="column" width={44} marginBottom={1}>
              <text fg={props.theme?.header} attributes={TextAttributes.BOLD}>{group}</text>
              <For each={entries}>
                {(entry) => (
                  <text wrapMode="none">
                    <span style={{ fg: props.theme?.mention }}>{`  ${entry.key.padEnd(9)}`}</span>
                    <span style={{ fg: props.theme?.fg }}>{entry.desc}</span>
                  </text>
                )}
              </For>
            </box>
          )}
        </For>
      </box>
      </scrollbox>
      </box>
    </box>
  );
}
