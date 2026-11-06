import type { CliRenderer, KeyEvent, Renderable } from "@opentui/core";
import type { Keymap } from "@opentui/keymap";
import { registerDefaultKeys } from "@opentui/keymap/addons";
import { createOpenTuiKeymap } from "@opentui/keymap/opentui";

export interface AppKeyHandlers {
  quit(): void;
  down(): void;
  up(): void;
  left(): void;
  right(): void;
  open(): void;
}

export function createAppKeymap(
  renderer: CliRenderer,
  handlers: AppKeyHandlers,
): Keymap<Renderable, KeyEvent> {
  const keymap = createOpenTuiKeymap(renderer);
  registerDefaultKeys(keymap);

  keymap.registerLayer({
    commands: [
      { name: "app.quit", run: () => (handlers.quit(), true) },
      { name: "nav.down", run: () => (handlers.down(), true) },
      { name: "nav.up", run: () => (handlers.up(), true) },
      { name: "nav.left", run: () => (handlers.left(), true) },
      { name: "nav.right", run: () => (handlers.right(), true) },
      { name: "nav.open", run: () => (handlers.open(), true) },
    ],
    bindings: [
      { key: "q", cmd: "app.quit" },
      { key: "j", cmd: "nav.down" },
      { key: "k", cmd: "nav.up" },
      { key: "h", cmd: "nav.left" },
      { key: "l", cmd: "nav.right" },
      { key: "return", cmd: "nav.open" },
    ],
  });

  return keymap;
}
