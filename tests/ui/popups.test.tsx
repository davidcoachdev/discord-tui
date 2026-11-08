import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import type { Actions } from "../../src/actions";
import { App } from "../../src/ui/App";
import { listWindow, moveInList } from "../../src/ui/list-window";
import { buildDemoStore, demoActions } from "../../scripts/demo-state";

const ESC = "\u001b[27u";

function setup() {
  const store = buildDemoStore();
  const reactions: string[] = [];
  const actions: Actions = {
    ...demoActions(store),
    toggleReaction: async (_c, _m, emoji) => void reactions.push(emoji.name),
  };
  return { store, actions, reactions };
}

async function render(s: ReturnType<typeof setup>, height = 45) {
  const r = await testRender(() => <App store={s.store} actions={s.actions} onQuit={() => {}} />, { width: 160, height });
  await r.renderOnce();
  return r;
}

function selectedLine(frame: string, marker: string): string | undefined {
  return frame.split("\n").find((line) => line.includes(marker));
}

test("listWindow keeps the chosen row visible and moveInList clamps", () => {
  expect(listWindow(0, 5, 12)).toEqual({ start: 0, end: 5 });
  expect(listWindow(20, 30, 12)).toEqual({ start: 14, end: 26 });
  expect(listWindow(29, 30, 12)).toEqual({ start: 18, end: 30 });
  expect(moveInList({ name: "down" }, 29, 30, 12)).toBe(29);
  expect(moveInList({ name: "pagedown" }, 0, 30, 12)).toBe(12);
  expect(moveInList({ name: "end" }, 0, 30, 12)).toBe(29);
  expect(moveInList({ name: "x" }, 0, 30, 12)).toBeNull();
});

test("quick switcher scrolls past the first 12 results with the keyboard and the wheel", async () => {
  const s = setup();
  const h = await render(s);
  h.mockInput.pressKey("k", { ctrl: true });
  await h.renderOnce();
  const total = Number(/ 1\/(\d+) /.exec(h.captureCharFrame())?.[1]);
  expect(total).toBeGreaterThan(12);
  for (let i = 0; i < total; i += 1) h.mockInput.pressArrow("down");
  await h.renderOnce();
  expect(h.captureCharFrame()).toContain(` ${total}/${total} `);
  expect(h.captureCharFrame()).toContain("↑");
  const frame = h.captureCharFrame();
  const line = frame.split("\n").findIndex((l) => l.includes("Saltar a"));
  // En la terminal real se dibuja entre vuelta y vuelta de la rueda (OpenTUI procesa un scroll por cuadro).
  for (let i = 0; i < 3; i += 1) {
    await h.mockMouse.scroll(80, line + 4, "up");
    await h.renderOnce();
  }
  expect(h.captureCharFrame()).toContain(` ${total - 3}/${total} `);
  h.mockInput.pressEnter();
  await h.renderOnce();
  expect(h.captureCharFrame()).not.toContain("Saltar a");
});

test("emoji picker: arrows choose, Enter reacts with the highlighted one; the wheel moves too", async () => {
  const s = setup();
  const h = await render(s);
  h.mockInput.pressKey("k");
  h.mockInput.pressKey("+");
  await h.renderOnce();
  expect(h.captureCharFrame()).toContain("reaccionar · escribí para buscar");
  h.mockInput.pressArrow("down");
  h.mockInput.pressArrow("down");
  await h.renderOnce();
  const third = selectedLine(h.captureCharFrame(), " 3/");
  expect(third).toBeDefined();
  h.mockInput.pressEnter();
  await h.renderOnce();
  expect(s.reactions).toHaveLength(1);
  expect(s.reactions[0]).not.toBe("👍");

  h.mockInput.pressKey("+");
  await h.renderOnce();
  const y = h.captureCharFrame().split("\n").findIndex((l) => l.includes("reaccionar · escribí"));
  await h.mockMouse.scroll(20, y + 3, "down");
  await h.renderOnce();
  expect(h.captureCharFrame()).toContain(" 2/");
  h.mockInput.pressKeys([ESC]);
  await h.renderOnce();
  expect(h.captureCharFrame()).not.toContain("reaccionar · escribí");
});

test("emoji picker shows more than 10 and filters by typing", async () => {
  const s = setup();
  const h = await render(s);
  h.mockInput.pressKey("+");
  await h.renderOnce();
  const total = Number(/ 1\/(\d+) /.exec(h.captureCharFrame())?.[1]);
  expect(total).toBeGreaterThan(10);
  await h.mockInput.typeText("fire");
  await h.renderOnce();
  expect(h.captureCharFrame()).toContain("🔥  fire");
});

test("mention popup moves with the wheel", async () => {
  const s = setup();
  const h = await render(s);
  h.mockInput.pressKey("i");
  await h.mockInput.typeText("@");
  await h.renderOnce();
  const y = h.captureCharFrame().split("\n").findIndex((l) => l.includes("@ mencionar"));
  expect(y).toBeGreaterThan(-1);
  await h.mockMouse.scroll(10, y + 1, "down");
  h.mockInput.pressTab();
  h.mockInput.pressEnter();
  await h.renderOnce();
  const last = s.store.getState().messages["920000000000000002"]!;
  const sent = last.byId[last.ids.at(-1)!]!.content;
  expect(sent).toMatch(/^<@\d+> $/);
});

test("help scrolls in a short terminal with j and the wheel, and closes with Esc", async () => {
  const s = setup();
  const h = await render(s, 30);
  h.mockInput.pressKey("?");
  await h.renderOnce();
  const before = h.captureCharFrame();
  expect(before).toContain("Navegación");
  for (let i = 0; i < 25; i += 1) h.mockInput.pressKey("j");
  await h.renderOnce();
  const after = h.captureCharFrame();
  expect(after).not.toBe(before);
  expect(after).toContain("salir");
  h.mockInput.pressKeys([ESC]);
  await h.renderOnce();
  expect(h.captureCharFrame()).not.toContain("Ayuda ·");
});
