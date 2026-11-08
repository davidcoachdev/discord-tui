import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createSignal, onCleanup, Show, type JSX } from "solid-js";

import { APP_NAME, APP_TAGLINE, APP_VERSION } from "../brand";
import type { Theme } from "../theme";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const LOGO_MIN_WIDTH = 52;

/** Qué está haciendo la conexión, en palabras. */
export function splashStatus(connection: string, guilds: number): string {
  if (connection === "connecting") return "conectando con Discord…";
  if (connection === "identifying") return "iniciando sesión…";
  if (connection === "resuming") return "retomando la sesión…";
  if (connection === "reconnecting") return "reconectando…";
  if (connection === "ready") return guilds > 0 ? `cargando ${guilds} servidores…` : "cargando…";
  return "preparando…";
}

/** Pantalla de inicio: logo con degradé animado, spinner y el paso de la conexión. */
export function Splash(props: { theme: Theme; status: string }): JSX.Element {
  const dims = useTerminalDimensions();
  const [tick, setTick] = createSignal(0);
  const timer = setInterval(() => setTick((t) => t + 1), 90);
  onCleanup(() => clearInterval(timer));

  // El degradé "corre" por las letras: se rota la paleta cada pocos ticks.
  const colors = (): string[] => {
    const palette = props.theme.brand;
    const shift = Math.floor(tick() / 3) % palette.length;
    return [...palette.slice(shift), ...palette.slice(0, shift)].slice(0, 5);
  };

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      zIndex={100}
      backgroundColor={props.theme.bg}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      rowGap={1}
    >
      <Show
        when={dims().width >= LOGO_MIN_WIDTH && dims().height >= 14}
        fallback={
          <text fg={colors()[0]} attributes={TextAttributes.BOLD}>
            {`◆ ${APP_NAME} ◆`}
          </text>
        }
      >
        <ascii_font text={APP_NAME} font="block" color={colors()} />
      </Show>
      <text fg={props.theme.header} attributes={TextAttributes.BOLD}>
        {APP_TAGLINE}
      </text>
      <box height={1} />
      <text fg={props.theme.dim}>
        <span style={{ fg: props.theme.accent }}>{`${SPINNER[tick() % SPINNER.length]} `}</span>
        {props.status}
      </text>
      <box height={1} />
      <text fg={props.theme.faint}>{`v${APP_VERSION} · texto · voz · pantalla compartida`}</text>
    </box>
  );
}
