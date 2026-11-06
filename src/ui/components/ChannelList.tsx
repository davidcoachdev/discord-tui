import { For, type JSX } from "solid-js";

import type { Actions } from "../../actions";
import { selectChannelList } from "../../store/selectors";
import type { Store } from "../../store/store";
import { useSelector } from "../store-bridge";

function icon(kind: string): string {
  if (kind === "voice") return "v";
  if (kind === "category") return "▾";
  return "#";
}

export function ChannelList(props: { store: Store; actions: Actions }): JSX.Element {
  const rows = useSelector(props.store, (state) =>
    state.ui.selectedGuildId === null ? [] : selectChannelList(state, state.ui.selectedGuildId),
  );
  const selected = useSelector(props.store, (state) => state.ui.selectedChannelId);

  return (
    <box title="Canales" border width={30} height="100%" flexDirection="column">
      <For each={rows()}>
        {(row) => (
          <text>
            {`${"  ".repeat(row.depth)}${selected() === row.id ? "› " : "  "}${icon(row.kind)} ${row.name}${
              row.unread ? " ●" : ""
            }${row.mentions > 0 ? ` (${row.mentions})` : ""}`}
          </text>
        )}
      </For>
    </box>
  );
}
