import { useKeyboard } from "@opentui/solid";
import { createSignal, For, Show, type JSX } from "solid-js";

import type { AudioDevice } from "../../voice/devices";
import { truncate } from "../format";
import { listWindow, moveInList } from "../list-window";
import type { Theme } from "../theme";
import type { Click } from "./Button";

const ROWS = 8;

/** Por dónde sale el audio de la llamada: click, ↑↓/j/k + Enter, rueda; Esc o click afuera cierra. */
export function OutputPicker(props: {
  outputs: AudioDevice[];
  current: string | null;
  isDefault: boolean;
  theme: Theme;
  onPick(name: string | null): void;
  onClose(): void;
}): JSX.Element {
  // Primera fila: "predeterminada del sistema" (null); después cada salida.
  const rows = (): { name: string | null; label: string }[] => [
    { name: null, label: "predeterminada del sistema" },
    ...props.outputs.map((o) => ({ name: o.name, label: o.description })),
  ];
  const chosenAt = (): number => (props.isDefault ? 0 : Math.max(0, rows().findIndex((r) => r.name === props.current)));
  const [index, setIndex] = createSignal(chosenAt());
  const view = () => listWindow(index(), rows().length, ROWS);
  const visible = () => rows().slice(view().start, view().end).map((row, i) => ({ row, at: view().start + i }));
  const pick = (i: number): void => {
    const row = rows()[i];
    if (row) props.onPick(row.name);
  };

  useKeyboard((key) => {
    if (key.eventType === "release") return;
    if (key.name === "escape" || key.name === "q") return props.onClose();
    if (key.name === "return") return pick(index());
    const vim = key.name === "j" ? "down" : key.name === "k" ? "up" : key.name;
    const moved = moveInList({ ...key, name: vim }, index(), rows().length, ROWS);
    if (moved !== null) setIndex(moved);
  });

  return (
    <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={60} onMouseDown={() => props.onClose()}>
      <box
        position="absolute"
        bottom={2}
        right={2}
        onMouseDown={(e: Click) => e.stopPropagation()}
        onMouseScroll={(e: { scroll?: { direction: string; delta?: number }; stopPropagation(): void }) => {
          e.stopPropagation();
          const steps = Math.max(1, Math.round(Math.abs(e.scroll?.delta ?? 1)));
          const delta = e.scroll?.direction === "down" ? steps : e.scroll?.direction === "up" ? -steps : 0;
          if (delta !== 0) setIndex((i) => Math.max(0, Math.min(rows().length - 1, i + delta)));
        }}
        border
        borderStyle="rounded"
        borderColor={props.theme.accent}
        backgroundColor={props.theme.panel}
        title=" ¿Por dónde escuchar la llamada? "
        titleColor={props.theme.accent}
        bottomTitle=" ↑↓ rueda · Enter elige · Esc cierra "
        bottomTitleAlignment="right"
        width={56}
        flexDirection="column"
      >
        <Show when={view().start > 0}>
          <text fg={props.theme.faint}>{`   ↑ ${view().start} más`}</text>
        </Show>
        <For each={visible()}>
          {(item) => {
            const inUse = (): boolean => (item.row.name === null ? props.isDefault : !props.isDefault && item.row.name === props.current);
            return (
              <box
                flexDirection="row"
                backgroundColor={item.at === index() ? props.theme.selection : undefined}
                onMouseDown={(e: Click) => {
                  e.stopPropagation();
                  pick(item.at);
                }}
              >
                <text fg={item.at === index() ? props.theme.selectionFg : props.theme.fg} wrapMode="none">
                  {` ${inUse() ? "✓" : " "} 🔈 ${truncate(item.row.label, 46)}`}
                </text>
              </box>
            );
          }}
        </For>
        <Show when={view().end < rows().length}>
          <text fg={props.theme.faint}>{`   ↓ ${rows().length - view().end} más`}</text>
        </Show>
      </box>
    </box>
  );
}
