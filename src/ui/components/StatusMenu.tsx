import { useKeyboard } from "@opentui/solid";
import { createSignal, For, type JSX } from "solid-js";

import { OWN_STATUSES, type OwnStatus } from "../../settings/settings";
import { presenceColor, type Theme } from "../theme";
import type { Click } from "./Button";

const LABELS: Record<OwnStatus, string> = {
  online: "● en línea",
  idle: "🌙 ausente",
  dnd: "⛔ no molestar",
  invisible: "○ invisible",
};

export function statusLabel(status: OwnStatus): string {
  return LABELS[status];
}

/** Color del estado propio (invisible se ve como desconectado). */
export function statusColor(theme: Theme, status: OwnStatus): string {
  return presenceColor(theme, status === "invisible" ? "offline" : status);
}

/** Menú chico para elegir el estado propio: click, j/k + Enter, Esc o click afuera cierra. */
export function StatusMenu(props: {
  current: OwnStatus;
  theme: Theme;
  onPick(status: OwnStatus): void;
  onClose(): void;
}): JSX.Element {
  const [index, setIndex] = createSignal(Math.max(0, OWN_STATUSES.indexOf(props.current)));

  useKeyboard((key) => {
    if (key.eventType === "release") return;
    if (key.name === "escape" || key.name === "q") return props.onClose();
    if (key.name === "j" || key.name === "down") return void setIndex((i) => Math.min(OWN_STATUSES.length - 1, i + 1));
    if (key.name === "k" || key.name === "up") return void setIndex((i) => Math.max(0, i - 1));
    if (key.name === "return") props.onPick(OWN_STATUSES[index()]!);
  });

  return (
    <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={60} onMouseDown={() => props.onClose()}>
      <box
        position="absolute"
        bottom={1}
        left={22}
        onMouseDown={(e: Click) => e.stopPropagation()}
        border
        borderStyle="rounded"
        borderColor={props.theme.accent}
        backgroundColor={props.theme.panel}
        title=" Estado "
        titleColor={props.theme.accent}
        width={22}
        flexDirection="column"
      >
        <For each={OWN_STATUSES}>
          {(status, i) => (
            <box
              flexDirection="row"
              backgroundColor={i() === index() ? props.theme.selection : undefined}
              onMouseDown={(e: Click) => {
                e.stopPropagation();
                props.onPick(status);
              }}
              onMouseOver={() => setIndex(i())}
            >
              <text fg={statusColor(props.theme, status)} wrapMode="none">
                {` ${statusLabel(status)}${status === props.current ? " ✓" : ""}`}
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
  );
}
