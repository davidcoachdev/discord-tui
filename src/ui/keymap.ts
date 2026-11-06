import type { CliRenderer, KeyEvent, Renderable } from "@opentui/core";
import type { Keymap } from "@opentui/keymap";
import { registerDefaultKeys } from "@opentui/keymap/addons";
import { createOpenTuiKeymap } from "@opentui/keymap/opentui";

export function createAppKeymap(
  renderer: CliRenderer,
  handlers: { quit(): void },
): Keymap<Renderable, KeyEvent> {
  const keymap = createOpenTuiKeymap(renderer);
  registerDefaultKeys(keymap);
  keymap.registerLayer({
    commands: [
      {
        name: "app.quit",
        run: () => {
          handlers.quit();
          return true;
        },
      },
    ],
    bindings: [{ key: "q", cmd: "app.quit" }],
  });
  return keymap;
}
