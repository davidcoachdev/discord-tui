import { expect, test } from "bun:test";
import { ImageRenderable, type Renderable } from "@opentui/core";
import { testRender } from "@opentui/solid";

import type { Actions } from "../../src/actions";
import { App } from "../../src/ui/App";
import { videoBox } from "../../src/ui/components/StreamViewer";
import { buildDemoStore, demoActions, DEMO } from "../../scripts/demo-state";
import { syntheticFrame } from "../../scripts/demo/watch";

// En la demo, Ramiro (U(1)) ya transmite en Sala 1 (seedGoLive).
const RAGNAR = "900000000000000101";

function setup() {
  const store = buildDemoStore();
  const base = demoActions(store);
  const calls: string[] = [];
  const voice = base.voice!;
  let subscriptions = 0;
  const actions: Actions = {
    ...base,
    voice: {
      ...voice,
      toggleWatch: (id) => (calls.push(`toggle:${id}`), voice.toggleWatch!(id)),
      watchStream: (id) => (calls.push(`watch:${id}`), voice.watchStream!(id)),
      stopWatching: () => (calls.push("stop"), voice.stopWatching!()),
      watchFrames: (w, h, fn) => {
        subscriptions++;
        const sub = voice.watchFrames!(w, h, fn);
        return { resize: sub.resize, unsubscribe: () => (subscriptions--, sub.unsubscribe()) };
      },
    },
  };
  return { store, actions, calls, subscriptions: () => subscriptions };
}

async function render(s: ReturnType<typeof setup>) {
  const r = await testRender(() => <App store={s.store} actions={s.actions} onQuit={() => {}} />, { width: 180, height: 50 });
  await r.renderOnce();
  return r;
}
type Harness = Awaited<ReturnType<typeof render>>;

function find(frame: string, text: string, nth = 0): { x: number; y: number } {
  const lines = frame.split("\n");
  let seen = 0;
  for (let y = 0; y < lines.length; y += 1) {
    const index = lines[y]!.indexOf(text);
    if (index !== -1 && seen++ === nth) return { x: Bun.stringWidth(lines[y]!.slice(0, index)) + Math.floor(Bun.stringWidth(text) / 2), y };
  }
  throw new Error(`no encontré "${text}" en pantalla`);
}

async function click(h: Harness, text: string, nth = 0): Promise<void> {
  const { x, y } = find(h.captureCharFrame(), text, nth);
  await h.mockMouse.click(x, y);
  await h.renderOnce();
  await Bun.sleep(5);
  await h.renderOnce();
}

function images(node: Renderable): ImageRenderable[] {
  const own = node instanceof ImageRenderable ? [node] : [];
  return [...own, ...node.getChildren().flatMap((child) => images(child as Renderable))];
}

async function settle(h: Harness, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await Bun.sleep(20);
    await h.renderOnce();
  }
}

test("▶ ver only shows for someone streaming in YOUR voice channel", async () => {
  const s = setup();
  const h = await render(s);
  expect(h.captureCharFrame()).toMatch(/Ramiro\s+📺/);
  expect(h.captureCharFrame()).not.toContain("▶ ver");
  await s.actions.voice!.toggleVoice(DEMO.voice);
  await h.renderOnce();
  expect(h.captureCharFrame()).toContain("▶ ver");
  await s.actions.voice!.leaveVoice();
  await h.renderOnce();
  expect(h.captureCharFrame()).not.toContain("▶ ver");
});

test("click ▶ ver → ⏳ conectando → the stream takes over the message pane → ✕ dejar de ver", async () => {
  const s = setup();
  const h = await render(s);
  await s.actions.voice!.toggleVoice(DEMO.voice);
  await h.renderOnce();
  await click(h, "▶ ver");
  expect(s.calls).toEqual([`toggle:${RAGNAR}`]);
  expect(h.captureCharFrame()).toContain("⏳ conectando con la transmisión de Ramiro…");
  expect(s.subscriptions()).toBe(1);
  await settle(h, 800);
  const live = h.captureCharFrame();
  expect(live).toMatch(/📺 Ramiro · en vivo · \d+ fps/);
  expect(live).toContain("✕ dejar de ver");
  expect(live).toContain("■ dejar de ver"); // en la lista de canales
  const img = images(h.renderer.root).find((i) => i.source !== undefined);
  expect(img).toBeDefined();
  await click(h, "✕ dejar de ver");
  expect(s.calls.at(-1)).toBe("stop");
  expect(h.captureCharFrame()).not.toContain("en vivo ·");
  expect(s.subscriptions()).toBe(0); // vista desmontada: no se decodifica nada
  await s.actions.voice!.leaveVoice();
});

test("the voice channel strip has ▶ ver <name> while you are in the call", async () => {
  const s = setup();
  const h = await render(s);
  await s.actions.voice!.toggleVoice(DEMO.voice);
  s.store.dispatch({ type: "ui/selectChannel", id: DEMO.voice });
  await h.renderOnce();
  expect(h.captureCharFrame()).toContain("▶ ver Ramiro");
  await click(h, "▶ ver Ramiro");
  expect(s.calls).toEqual([`toggle:${RAGNAR}`]);
  await s.actions.voice!.leaveVoice();
});

test("w watches the first streamer in your channel; Esc stops watching", async () => {
  const s = setup();
  const h = await render(s);
  h.mockInput.pressKey("w");
  await h.renderOnce();
  expect(s.calls).toEqual([]); // fuera de la voz: solo un aviso
  await s.actions.voice!.toggleVoice(DEMO.voice);
  await h.renderOnce();
  h.mockInput.pressKey("w");
  await h.renderOnce();
  expect(s.calls).toEqual([`watch:${RAGNAR}`]);
  expect(h.captureCharFrame()).toContain("conectando con la transmisión de Ramiro");
  h.mockInput.pressEscape();
  await Bun.sleep(80);
  await h.renderOnce();
  expect(s.calls.at(-1)).toBe("stop");
  expect(h.captureCharFrame()).not.toContain("conectando con la transmisión");
  await s.actions.voice!.leaveVoice();
});

test("leaving the voice channel closes the viewer", async () => {
  const s = setup();
  const h = await render(s);
  await s.actions.voice!.toggleVoice(DEMO.voice);
  await s.actions.voice!.watchStream!(RAGNAR);
  await settle(h, 600);
  expect(h.captureCharFrame()).toContain("📺 Ramiro · en vivo");
  await s.actions.voice!.leaveVoice();
  await h.renderOnce();
  expect(h.captureCharFrame()).not.toContain("📺 Ramiro · en vivo");
  expect(s.subscriptions()).toBe(0);
});

test("an error keeps the pane with the Spanish message and ✕ cerrar", async () => {
  const s = setup();
  const h = await render(s);
  await s.actions.voice!.toggleVoice(DEMO.voice);
  s.store.dispatch({ type: "voice/watch", patch: { status: "error", userId: RAGNAR, error: "no tenés permiso para ver esta transmisión" } });
  await h.renderOnce();
  const frame = h.captureCharFrame();
  expect(frame).toContain("no tenés permiso para ver esta transmisión");
  expect(frame).toContain("✕ cerrar");
  await click(h, "✕ cerrar");
  expect(s.store.getState().voice.watch.status).toBe("idle");
  await s.actions.voice!.leaveVoice();
});

test("videoBox caps the decoder box (CPU and terminal bandwidth)", () => {
  expect(videoBox(64, 18)).toEqual({ width: 640, height: 360 });
  expect(videoBox(200, 60)).toEqual({ width: 960, height: 540 });
  expect(syntheticFrame(8, 4, 0).rgba.length).toBe(8 * 4 * 4);
});
