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
  expect(assertTty({ isTTY: false })).toBe("zcord necesita una terminal");
  expect(assertTty({ isTTY: true })).toBeNull();
});

test("? shows the grouped help and Esc closes only the help", async () => {
  const { store, actions } = setup();
  const { mockInput, renderOnce, captureCharFrame } = await testRender(
    () => <App store={store} actions={actions} onQuit={() => {}} />,
    { width: 100, height: 40 },
  );
  await renderOnce();
  mockInput.pressKeys(["?"]);
  await renderOnce();
  expect(captureCharFrame()).toContain("Navegación");
  // Esc cierra la ayuda y no dispara nada más (el resto del layout sigue ahí).
  mockInput.pressKeys(["\u001b[27u"]);
  await Bun.sleep(1);
  await renderOnce();
  const after = captureCharFrame();
  expect(after).not.toContain("mostrar esta ayuda");
  expect(after).toContain("Servidores");
});

test("gm calls toggleMembers", async () => {
  const { store, actions } = setup();
  let calls = 0;
  actions.toggleMembers = () => {
    calls += 1;
  };
  const { mockInput, renderOnce } = await testRender(() => <App store={store} actions={actions} onQuit={() => {}} />, {
    width: 100,
    height: 30,
  });
  await renderOnce();
  mockInput.pressKey("g");
  mockInput.pressKey("m");
  await renderOnce();
  expect(calls).toBe(1);
});

test("click on a channel opens it", async () => {
  const { store, actions } = setup();
  let opened: string | null = null as string | null;
  actions.openChannel = async (id: string) => {
    opened = id;
  };
  store.dispatch({ type: "ui/selectGuild", id: "guild1" });
  store.dispatch({
    type: "gw",
    t: "READY",
    d: {
      user: { id: "me1", username: "me" },
      guilds: [
        {
          id: "guild1",
          name: "Test",
          owner_id: "me1",
          roles: [],
          emojis: [],
          channels: [{ id: "ch1", type: 0, name: "general", position: 0, permission_overwrites: [] }],
        },
      ],
      private_channels: [],
      users: [],
    },
  });
  const { mockMouse, renderOnce, captureCharFrame } = await testRender(
    () => <App store={store} actions={actions} onQuit={() => {}} />,
    { width: 100, height: 30 },
  );
  await renderOnce();
  const frame = captureCharFrame();
  const lines = frame.split("\n");
  const lineIndex = lines.findIndex((line) => line.includes("general"));
  expect(lineIndex).toBeGreaterThan(-1);
  await mockMouse.click(25, lineIndex);
  await renderOnce();
  expect(opened).toBe("ch1");
});
