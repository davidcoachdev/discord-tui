import type { JSX } from "solid-js";

import type { Store } from "../../store/store";
import { useSelector } from "../store-bridge";

function connectionLabel(connection: string): string {
  if (connection === "ready") return "conectado";
  if (connection === "reconnecting") return "reconectando…";
  if (connection === "resuming") return "reanudando…";
  if (connection === "connecting" || connection === "identifying") return "conectando…";
  return "desconectado";
}

export function StatusBar(props: { store: Store }): JSX.Element {
  const connection = useSelector(props.store, (state) => state.connection);
  const me = useSelector(props.store, (state) => state.me);

  return (
    <box height={1} width="100%" paddingLeft={1}>
      <text>{`${connectionLabel(connection())} · logueado como ${me()?.username ?? "…"}`}</text>
    </box>
  );
}
