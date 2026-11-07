import { For, type JSX } from "solid-js";

import type { Actions } from "../../actions";
import { selectGuildList } from "../../store/selectors";
import type { Store } from "../../store/store";
import { useSelector } from "../store-bridge";

export function GuildList(props: { store: Store; actions: Actions }): JSX.Element {
  const rows = useSelector(props.store, (state) => selectGuildList(state));
  const selected = useSelector(props.store, (state) => state.ui.selectedGuildId);

  const marker = (id: string) => (selected() === id ? "› " : "  ");

  return (
    <box title="Servidores" border width={22} height="100%" flexDirection="column">
      <text onMouseDown={() => props.actions.selectGuild("@dms")}>{`${marker("@dms")}Mensajes directos`}</text>
      <For each={rows()}>
        {(row) => (
          <text onMouseDown={() => props.actions.selectGuild(row.id)}>
            {`${marker(row.id)}${row.name}${row.unread ? " ●" : ""}${row.mentions > 0 ? ` (${row.mentions})` : ""}`}
          </text>
        )}
      </For>
    </box>
  );
}
