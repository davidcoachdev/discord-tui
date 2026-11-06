import { onMount } from "solid-js";
import { useRenderer, type JSX } from "@opentui/solid";

import { createAppKeymap } from "./keymap";

function StatusBar(): JSX.Element {
  return (
    <box height={1} width="100%" paddingLeft={1}>
      <text>desconectado</text>
    </box>
  );
}

export function App(props: { onQuit: () => void }): JSX.Element {
  const renderer = useRenderer();

  onMount(() => {
    createAppKeymap(renderer, { quit: props.onQuit });
  });

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box flexDirection="row" flexGrow={1} width="100%">
        <box title="Servidores" border flexGrow={1} height="100%" />
        <box title="Canales" border flexGrow={2} height="100%" />
        <box title="Mensajes" border flexGrow={4} height="100%" />
      </box>
      <StatusBar />
    </box>
  );
}
