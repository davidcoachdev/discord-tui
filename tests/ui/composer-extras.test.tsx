import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import type { Actions } from "../../src/actions";
import { App } from "../../src/ui/App";
import { buildDemoStore, DEMO } from "../../scripts/demo-state";

function setup() {
  const store = buildDemoStore();
  const sent: { channelId: string; content: string; opts: any }[] = [];
  const calls: string[] = [];
  const actions: Actions = {
    selectGuild: (id) => store.dispatch({ type: "ui/selectGuild", id }),
    openChannel: async (id) => store.dispatch({ type: "ui/selectChannel", id }),
    loadOlder: async (id) => void calls.push(`older:${id}`),
    focus: (focus) => store.dispatch({ type: "ui/focus", focus }),
    toggleMembers: () => {},
    send: async (channelId, content, opts = {}) => void sent.push({ channelId, content, opts }),
    retry: async () => {},
    edit: async (_c, id, content) => void calls.push(`edit:${id}:${content}`),
    remove: async (_c, id) => void calls.push(`remove:${id}`),
    toggleReaction: async (_c, id, emoji) => void calls.push(`react:${id}:${emoji.name}`),
    keystroke: (channelId) => void calls.push(`typing:${channelId}`),
  };
  return { store, actions, sent, calls };
}

const png = new Uint8Array([137, 80, 78, 71]);

async function render(s: ReturnType<typeof setup>, deps: any = {}) {
  return testRender(() => <App store={s.store} actions={s.actions} onQuit={() => {}} deps={deps} />, { width: 160, height: 45 });
}

test("@ + Tab picks a mention and it is sent as <@id>; typing notifies", async () => {
  const s = setup();
  const { mockInput, renderOnce, captureCharFrame } = await render(s);
  await renderOnce();
  mockInput.pressKey("i");
  await mockInput.typeText("hola @rag");
  await renderOnce();
  expect(captureCharFrame()).toContain("@ mencionar");
  mockInput.pressTab();
  await mockInput.typeText("todo bien");
  mockInput.pressEnter();
  await renderOnce();
  expect(s.sent[0]!.content).toBe("hola <@900000000000000101> todo bien");
  expect(s.calls).toContain(`typing:${DEMO.general}`);
});

test("Ctrl-v with an image in the clipboard attaches it; Enter sends it", async () => {
  const s = setup();
  const { mockInput, renderOnce, captureCharFrame } = await render(s, {
    readClipboardImage: async () => ({ bytes: png, mime: "image/png", filename: "captura-20261107-120000.png" }),
    readClipboardText: async () => null,
  });
  await renderOnce();
  mockInput.pressKey("v", { ctrl: true });
  await Bun.sleep(5);
  await renderOnce();
  expect(captureCharFrame()).toContain("📎 captura-20261107-120000.png (4 B) · x quita");
  mockInput.pressEnter();
  await renderOnce();
  expect(s.sent[0]!.opts.attachments[0].filename).toBe("captura-20261107-120000.png");
});

test("Ctrl-v without an image pastes the clipboard text", async () => {
  const s = setup();
  const { mockInput, renderOnce } = await render(s, {
    readClipboardImage: async () => null,
    readClipboardText: async () => "texto pegado",
  });
  await renderOnce();
  mockInput.pressKey("i");
  mockInput.pressKey("v", { ctrl: true });
  await Bun.sleep(5);
  mockInput.pressEnter();
  await renderOnce();
  expect(s.sent[0]!.content).toBe("texto pegado");
});

test("a asks for a path and attaches the file; errors are shown", async () => {
  const s = setup();
  const { mockInput, renderOnce, captureCharFrame } = await render(s, {
    readAttachmentFromPath: async (p: string) => {
      if (p === "~/nada") throw new Error("no existe");
      return { filename: "doc.pdf", mime: "application/pdf", bytes: new Uint8Array(2048) };
    },
  });
  await renderOnce();
  mockInput.pressKey("a");
  await mockInput.typeText("~/nada");
  mockInput.pressEnter();
  await Bun.sleep(5);
  await renderOnce();
  expect(captureCharFrame()).toContain("no se pudo adjuntar: no existe");
  mockInput.pressKey("a");
  await mockInput.typeText("~/doc.pdf");
  mockInput.pressEnter();
  await Bun.sleep(5);
  await renderOnce();
  expect(captureCharFrame()).toContain("📎 doc.pdf (2 KB)");
});

test("k selects messages upwards and asks for older history at the top", async () => {
  const s = setup();
  const { mockInput, renderOnce } = await render(s);
  await renderOnce();
  for (let i = 0; i < 12; i += 1) mockInput.pressKey("k");
  await renderOnce();
  expect(s.calls).toContain(`older:${DEMO.general}`);
});

test("e edits the own selected message; dd + y deletes it; + reacts", async () => {
  const s = setup();
  const { mockInput, renderOnce } = await render(s);
  await renderOnce();
  mockInput.pressKey("k");
  mockInput.pressKey("k"); // el anteúltimo es de Gon
  mockInput.pressKey("e");
  await mockInput.typeText("!");
  mockInput.pressEnter();
  await Bun.sleep(5);
  mockInput.pressKey("k");
  mockInput.pressKey("j");
  mockInput.pressKey("d");
  mockInput.pressKey("d");
  mockInput.pressKey("y");
  mockInput.pressKey("+");
  await mockInput.typeText("fire");
  mockInput.pressEnter();
  await renderOnce();
  const own = "930000000000001009";
  expect(s.calls.some((c) => c.startsWith(`edit:${own}:`) && c.endsWith("!"))).toBe(true);
  expect(s.calls).toContain(`remove:${own}`);
  expect(s.calls.some((c) => c.endsWith(":🔥"))).toBe(true);
});
