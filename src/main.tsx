import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";

import { App } from "./ui/App";

export function assertTty(stream: { isTTY?: boolean }): string | null {
  return stream.isTTY ? null : "discord-tui necesita una terminal";
}

async function main(): Promise<void> {
  const message = assertTty(process.stdout);
  if (message) {
    process.stderr.write(message + "\n");
    process.exit(1);
  }

  const renderer = await createCliRenderer({ useKittyKeyboard: { events: true } });
  await render(
    () => (
      <App
        onQuit={() => {
          renderer.destroy();
          void renderer.closed.then(() => process.exit(0));
        }}
      />
    ),
    renderer,
  );
}

if (import.meta.main) await main();
