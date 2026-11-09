import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import { App } from "../../src/ui/App";
import { buildDemoStore, demoActions } from "../../scripts/demo-state";

async function setup() {
  const store = buildDemoStore();
  const copied: string[] = [];
  const deps = {
    readClipboardFiles: async () => [],
    readClipboardImage: async () => null,
    readClipboardText: async () => null,
    writeClipboardText: async (text: string) => (copied.push(text), true),
  };
  const h = await testRender(() => <App store={store} actions={demoActions(store)} onQuit={() => {}} deps={deps as never} />, { width: 160, height: 45 });
  await h.renderOnce();
  return { h, copied };
}

function find(frame: string, text: string): { x: number; y: number } {
  const lines = frame.split("\n");
  for (let y = 0; y < lines.length; y++) {
    const i = lines[y]!.indexOf(text);
    if (i !== -1) return { x: Bun.stringWidth(lines[y]!.slice(0, i)), y };
  }
  throw new Error(`no encontré "${text}"`);
}

test("dragging over a message copies the selected text and says so", async () => {
  const { h, copied } = await setup();
  const { x, y } = find(h.captureCharFrame(), "Dile que acá ya hay dj");
  await h.mockMouse.drag(x, y, x + "Dile que acá".length, y);
  await Bun.sleep(10);
  await h.renderOnce();
  expect(copied).toEqual(["Dile que acá"]);
  expect(h.captureCharFrame()).toContain("📋 copiado (12 caracteres)");
});

test("a plain click (no drag) copies nothing", async () => {
  const { h, copied } = await setup();
  const { x, y } = find(h.captureCharFrame(), "Dile que acá ya hay dj");
  await h.mockMouse.click(x + 2, y);
  await Bun.sleep(10);
  await h.renderOnce();
  expect(copied).toEqual([]);
});
