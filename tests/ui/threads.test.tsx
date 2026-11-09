import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import type { Actions } from "../../src/actions";
import { App } from "../../src/ui/App";
import { buildDemoStore, demoActions } from "../../scripts/demo-state";
import { DEMO_THREADS } from "../../scripts/demo/threads";

function setup() {
  const store = buildDemoStore();
  const base = demoActions(store);
  const calls: string[] = [];
  const log =
    <A extends unknown[], R>(name: string, fn: (...args: A) => R) =>
    (...args: A): R => {
      calls.push(`${name}:${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(":")}`);
      return fn(...args);
    };
  const actions: Actions = {
    ...base,
    openChannel: log("openChannel", base.openChannel),
    send: log("send", base.send),
    loadArchivedPosts: log("loadArchivedPosts", async () => {}),
  };
  return { store, actions, calls };
}

async function render(s: ReturnType<typeof setup>, width = 160, height = 50) {
  const r = await testRender(() => <App store={s.store} actions={s.actions} onQuit={() => {}} />, { width, height });
  await r.renderOnce();
  return r;
}

type Harness = Awaited<ReturnType<typeof render>>;

function find(frame: string, text: string): { x: number; y: number } {
  const lines = frame.split("\n");
  for (let y = 0; y < lines.length; y += 1) {
    const index = lines[y]!.indexOf(text);
    if (index !== -1) return { x: Bun.stringWidth(lines[y]!.slice(0, index)) + Math.floor(Bun.stringWidth(text) / 2), y };
  }
  throw new Error(`no encontré "${text}" en pantalla`);
}

async function click(h: Harness, text: string): Promise<void> {
  const { x, y } = find(h.captureCharFrame(), text);
  await h.mockMouse.click(x, y);
  await h.renderOnce();
  await Bun.sleep(5);
  await h.renderOnce();
}

test("a thread hangs under its channel; clicking it opens it and the composer sends to the thread", async () => {
  const s = setup();
  const h = await render(s);
  const lines = h.captureCharFrame().split("\n");
  const thread = lines.findIndex((line) => line.includes("└ torneo de ajedrez"));
  expect(lines[thread - 1]).toContain("  # 💬-general");
  expect(lines[thread + 1]).toContain("└ qué música para codear");

  await click(h, "└ torneo de ajedrez");
  expect(s.calls).toContain(`openChannel:${DEMO_THREADS.ajedrez}`);
  expect(s.store.getState().ui.selectedChannelId).toBe(DEMO_THREADS.ajedrez);
  const frame = h.captureCharFrame();
  expect(frame).toContain("🧵 torneo de ajedrez · #💬-general");
  expect(frame).toContain("blitz 5+3 por favor");

  await click(h, "i para escribir en 🧵 torneo de ajedrez");
  await h.mockInput.typeText("me sumo");
  h.mockInput.pressEnter();
  await h.renderOnce();
  expect(s.calls.find((c) => c.startsWith("send:"))).toBe(`send:${DEMO_THREADS.ajedrez}:me sumo:{}`);
  expect(h.captureCharFrame()).toContain("me sumo");
});

test("a forum lists its posts, active first; clicking one opens it", async () => {
  const s = setup();
  const h = await render(s);
  await click(h, "💬 🆘-ayuda");
  expect(s.store.getState().ui.selectedChannelId).toBe(DEMO_THREADS.forum);
  const frame = h.captureCharFrame();
  const bug = find(frame, "no me anda el micrófono").y;
  const idea = find(frame, "idea: modo compacto").y;
  const old = find(frame, "cómo instalar en arch").y;
  expect(bug).toBeLessThan(idea);
  expect(idea).toBeLessThan(old);
  expect(frame).toContain("archivado");
  expect(frame).toContain("foro · abrí un post");

  await click(h, "idea: modo compacto");
  expect(s.calls).toContain(`openChannel:${DEMO_THREADS.postIdea}`);
  expect(h.captureCharFrame()).toContain("🧵 idea: modo compacto para la lista 🔒 · 💬🆘-ayuda");
});

test("archived posts are fetched only when the user asks (button or a)", async () => {
  const s = setup();
  const h = await render(s);
  await click(h, "💬 🆘-ayuda");
  expect(s.calls.some((c) => c.startsWith("loadArchivedPosts"))).toBe(false);
  await click(h, "⟳ cargar posts archivados");
  expect(s.calls).toContain(`loadArchivedPosts:${DEMO_THREADS.forum}`);
  h.mockInput.pressKey("a");
  await h.renderOnce();
  expect(s.calls.filter((c) => c.startsWith("loadArchivedPosts")).length).toBe(2);
});

test("keyboard: j/k walk threads in the channel list, and j + Enter open a forum post", async () => {
  const s = setup();
  const h = await render(s);
  h.mockInput.pressKey("h");
  h.mockInput.pressKey("j");
  await h.renderOnce();
  expect(s.store.getState().ui.selectedChannelId).toBe(DEMO_THREADS.ajedrez);
  // Hasta el foro: música, youtube, memes, devland, opentui, ayuda.
  for (let i = 0; i < 6; i += 1) h.mockInput.pressKey("j");
  h.mockInput.pressEnter();
  await h.renderOnce();
  expect(s.store.getState().ui.selectedChannelId).toBe(DEMO_THREADS.forum);
  expect(s.store.getState().ui.focus).toBe("messages");
  h.mockInput.pressKey("j");
  h.mockInput.pressEnter();
  await h.renderOnce();
  expect(s.store.getState().ui.selectedChannelId).toBe(DEMO_THREADS.postBug);
});

test("threads collapse with their channel's category", async () => {
  const s = setup();
  const h = await render(s);
  await click(h, "COMUNIDAD");
  const frame = h.captureCharFrame();
  expect(frame).not.toContain("torneo de ajedrez");
  expect(frame).not.toContain("🆘-ayuda");
  expect(frame).toContain("› ⭐ COMUNIDAD");
});

test("the quick switcher finds threads and forum posts", async () => {
  const s = setup();
  const h = await render(s);
  h.mockInput.pressKey("k", { ctrl: true });
  await h.renderOnce();
  await h.mockInput.typeText("torneo");
  await h.renderOnce();
  expect(h.captureCharFrame()).toContain("Los Andes › #💬-general › 🧵 torneo de ajedrez");
  h.mockInput.pressEnter();
  await h.renderOnce();
  expect(s.store.getState().ui.selectedChannelId).toBe(DEMO_THREADS.ajedrez);
  expect(s.calls).toContain(`openChannel:${DEMO_THREADS.ajedrez}`);

  h.mockInput.pressKey("k", { ctrl: true });
  await h.renderOnce();
  await h.mockInput.typeText("pipewire");
  await h.renderOnce();
  expect(h.captureCharFrame()).toContain("Los Andes › 💬 🆘-ayuda › 🧵 no me anda");
});

test("at 100x30 the thread header fits in the border", async () => {
  const s = setup();
  s.store.dispatch({ type: "ui/selectChannel", id: DEMO_THREADS.postIdea });
  const h = await render(s, 100, 30);
  expect(h.captureCharFrame().split("\n")[0]).toContain("🧵 idea: modo compacto");
});
