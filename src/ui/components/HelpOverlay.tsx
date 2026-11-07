import { For, type JSX } from "solid-js";

import { keysByGroup } from "../keys";

export function HelpOverlay(props: { onClose(): void }): JSX.Element {
  const groups = keysByGroup();

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      <text>Ayuda · ? o Esc cierra</text>
      <For each={[...groups.entries()]}>
        {([group, entries]) => (
          <box flexDirection="column" marginTop={1}>
            <text>{group}</text>
            <For each={entries}>{(entry) => <text>{`  ${entry.key.padEnd(8)} ${entry.desc}`}</text>}</For>
          </box>
        )}
      </For>
    </box>
  );
}
