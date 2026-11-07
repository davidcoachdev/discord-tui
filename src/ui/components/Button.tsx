import { createSignal, type JSX } from "solid-js";

import type { Theme } from "../theme";

export type Click = { stopPropagation(): void };

/** Botón de una línea: resalta con el mouse encima y no deja pasar el click a la fila de atrás. */
export function Button(props: {
  label: string;
  theme: Theme;
  danger?: boolean;
  active?: boolean;
  onPress(): void;
}): JSX.Element {
  const [hover, setHover] = createSignal(false);
  const bg = (): string => {
    if (hover()) return props.danger ? props.theme.error : props.theme.accent;
    if (props.active) return props.danger ? props.theme.error : props.theme.mentionBg;
    return props.theme.selection;
  };
  const fg = (): string => {
    if (hover()) return props.theme.modeFg;
    if (props.active) return props.danger ? props.theme.modeFg : props.theme.mentionFg;
    return props.danger ? props.theme.error : props.theme.fg;
  };
  return (
    <text
      fg={fg()}
      bg={bg()}
      wrapMode="none"
      flexShrink={0}
      onMouseDown={(e: Click) => {
        e.stopPropagation();
        props.onPress();
      }}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
    >
      {` ${props.label} `}
    </text>
  );
}
