import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import type { Actions } from "../../src/actions";
import { App } from "../../src/ui/App";
import { buildDemoStore, demoActions, DEMO } from "../../scripts/demo-state";

function setup() {
  const store = buildDemoStore();
  const base = demoActions(store);
  const calls: string[] = [];
  const voice = base.voice!;
  const actions: Actions = {
    ...base,
    voice: {
      ...voice,
      startStream: (monitor) => (calls.push(`start:${monitor ?? ""}`), voice.startStream!(monitor)),
      stopStream: () => (calls.push("stop"), voice.stopStream!()),
    },
  };
  return { store, actions, calls };
}

async function render(s: ReturnType<typeof setup>) {
  const r = await testRender(() => <App store={s.store} actions={s.actions} onQuit={() => {}} />, { width: 180, height: 50 });
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

async function joinVoice(s: ReturnType<typeof setup>) {
  await s.actions.voice!.toggleVoice(DEMO.voice);
}

test("the voice bar has a 📺 transmitir button only while in a call", async () => {
  const s = setup();
  const h = await render(s);
  expect(h.captureCharFrame()).not.toContain("📺 transmitir");
  await joinVoice(s);
  await h.renderOnce();
  expect(h.captureCharFrame()).toContain("📺 transmitir");
  await s.actions.voice!.leaveVoice();
});

test("click 📺 transmitir → ⏳ iniciando… → 🔴 EN VIVO · detener → click stops", async () => {
  const s = setup();
  const h = await render(s);
  await joinVoice(s);
  await h.renderOnce();
  await click(h, "📺 transmitir");
  expect(s.calls).toEqual(["start:"]);
  expect(h.captureCharFrame()).toContain("⏳ iniciando…");
  await Bun.sleep(650);
  await h.renderOnce();
  const live = h.captureCharFrame();
  expect(live).toContain("🔴 EN VIVO · detener");
  expect(live).toContain("👁 1");
  await click(h, "🔴 EN VIVO · detener");
  expect(s.calls).toEqual(["start:", "stop"]);
  expect(h.captureCharFrame()).toContain("📺 transmitir");
  await s.actions.voice!.leaveVoice();
});

test("a stream error shows in the voice bar", async () => {
  const s = setup();
  const h = await render(s);
  await joinVoice(s);
  s.store.dispatch({ type: "voice/stream", patch: { status: "error", error: "no hay con qué capturar la pantalla" } });
  await h.renderOnce();
  expect(h.captureCharFrame()).toContain("✗ transmisión: no hay con qué");
  await s.actions.voice!.leaveVoice();
});
