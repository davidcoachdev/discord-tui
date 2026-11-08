import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import type { Actions } from "../../src/actions";
import type { OwnStatus } from "../../src/settings/settings";
import { App } from "../../src/ui/App";
import { buildDemoStore, demoActions } from "../../scripts/demo-state";

function setup() {
  const store = buildDemoStore();
  const picked: OwnStatus[] = [];
  const base = demoActions(store);
  const actions: Actions = {
    ...base,
    setStatus: (status) => {
      picked.push(status);
      base.setStatus!(status);
    },
  };
  return { store, actions, picked };
}

async function render(s: ReturnType<typeof setup>) {
  const r = await testRender(() => <App store={s.store} actions={s.actions} onQuit={() => {}} />, { width: 160, height: 45 });
  await r.renderOnce();
  return r;
}

function find(frame: string, text: string): { x: number; y: number } {
  const lines = frame.split("\n");
  for (let y = lines.length - 1; y >= 0; y -= 1) {
    const index = lines[y]!.indexOf(text);
    if (index !== -1) return { x: Bun.stringWidth(lines[y]!.slice(0, index)) + Math.floor(Bun.stringWidth(text) / 2), y };
  }
  throw new Error(`no encontré "${text}" en pantalla`);
}

async function click(h: Awaited<ReturnType<typeof render>>, text: string): Promise<void> {
  const { x, y } = find(h.captureCharFrame(), text);
  await h.mockMouse.click(x, y);
  await h.renderOnce();
  await Bun.sleep(5);
  await h.renderOnce();
}

test("the status chip opens the menu and a click picks the status through the action", async () => {
  const s = setup();
  const h = await render(s);
  expect(h.captureCharFrame()).toContain("● en línea ▾");
  await click(h, "● en línea ▾");
  expect(h.captureCharFrame()).toContain("Estado");
  expect(h.captureCharFrame()).toContain("⛔ no molestar");
  await click(h, "⛔ no molestar");
  expect(s.picked).toEqual(["dnd"]);
  const frame = h.captureCharFrame();
  expect(frame).not.toContain("─ Estado ─");
  expect(frame).toContain("⛔ no molestar ▾");
  expect(s.store.getState().settings.status).toBe("dnd");
});

test("a click outside the menu closes it without changing anything", async () => {
  const s = setup();
  const h = await render(s);
  await click(h, "● en línea ▾");
  await h.mockMouse.click(80, 5);
  await h.renderOnce();
  expect(h.captureCharFrame()).not.toContain("─ Estado ─");
  expect(s.picked).toEqual([]);
});

test("gp opens the menu, j/k move, Enter picks; Esc closes", async () => {
  const s = setup();
  const h = await render(s);
  h.mockInput.pressKey("g");
  h.mockInput.pressKey("p");
  await h.renderOnce();
  expect(h.captureCharFrame()).toContain("─ Estado ─");
  for (const k of ["j", "j", "j", "k"]) h.mockInput.pressKey(k);
  h.mockInput.pressEnter();
  await Bun.sleep(5);
  await h.renderOnce();
  expect(s.picked).toEqual(["dnd"]);
  expect(h.captureCharFrame()).not.toContain("─ Estado ─");

  h.mockInput.pressKey("g");
  h.mockInput.pressKey("p");
  await h.renderOnce();
  expect(h.captureCharFrame()).toContain("─ Estado ─");
  h.mockInput.pressKeys(["\u001b[27u"]);
  await Bun.sleep(5);
  await h.renderOnce();
  expect(h.captureCharFrame()).not.toContain("─ Estado ─");
  expect(s.picked).toEqual(["dnd"]);
});

test("the settings screen has a status row that cycles through the action", async () => {
  const s = setup();
  const h = await render(s);
  h.mockInput.pressKey("g");
  h.mockInput.pressKey("s");
  await h.renderOnce();
  expect(h.captureCharFrame()).toContain("estado: ● en línea");
  await click(h, "estado: ● en línea");
  expect(s.picked).toEqual(["idle"]);
  expect(h.captureCharFrame()).toContain("estado: 🌙 ausente");
});
