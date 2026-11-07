import { TextAttributes } from "@opentui/core";
import { For, type JSX } from "solid-js";

import { keysByGroup } from "../keys";
import type { Theme } from "../theme";
import type { Click } from "./Button";

export function HelpOverlay(props: { onClose(): void; theme?: Theme }): JSX.Element {
  const groups = [...keysByGroup().entries()];
  const accent = (): string | undefined => props.theme?.accent;
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
        flexDirection="row"
        flexWrap="wrap"
        width={96}
        padding={1}
        columnGap={3}
      >
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
    </box>
  );
}
