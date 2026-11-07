import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import type { Actions } from "../../src/actions";
import { assertTty } from "../../src/main";
import { emptyState, createStore } from "../../src/store/store";
import { App } from "../../src/ui/App";

function setup() {
  const store = createStore(emptyState());
  const actions: Actions = {
    selectGuild: () => {},
    openChannel: async () => {},
    loadOlder: async () => {},
    focus: () => {},
    toggleMembers: () => {},
    send: async () => {},
    retry: async () => {},
    edit: async () => {},
    remove: async () => {},
    toggleReaction: async () => {},
  };
  return { store, actions };
}

test("renders the three empty columns and the status bar", async () => {
  const { store, actions } = setup();
  const { captureCharFrame, renderOnce } = await testRender(() => <App store={store} actions={actions} onQuit={() => {}} />, {
    width: 100,
    height: 30,
  });
  await renderOnce();
  const f = captureCharFrame();
  for (const s of ["Servidores", "Canales", "Mensajes", "desconectado"]) expect(f).toContain(s);
});

test("q calls onQuit", async () => {
  let quit = 0;
  const { store, actions } = setup();
  const { mockInput, renderOnce } = await testRender(() => <App store={store} actions={actions} onQuit={() => quit++} />, {
    width: 100,
    height: 30,
  });
  mockInput.pressKey("q");
  await renderOnce();
  expect(quit).toBe(1);
});

test("tiny terminal still renders", async () => {
  const { store, actions } = setup();
  const { renderOnce } = await testRender(() => <App store={store} actions={actions} onQuit={() => {}} />, {
    width: 40,
    height: 10,
  });
  await expect(renderOnce()).resolves.toBeUndefined();
});

test("assertTty", () => {
  expect(assertTty({ isTTY: false })).toBe("discord-tui necesita una terminal");
  expect(assertTty({ isTTY: true })).toBeNull();
});
