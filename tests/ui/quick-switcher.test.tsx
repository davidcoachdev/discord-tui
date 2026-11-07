import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import { App } from "../../src/ui/App";
import { buildDemoStore, demoActions } from "../../scripts/demo-state";

test("Ctrl-k opens, typing filters, Enter opens the channel, Esc closes", async () => {
  const store = buildDemoStore();
  const actions = demoActions(store);
  const { mockInput, renderOnce, captureCharFrame } = await testRender(
    () => <App store={store} actions={actions} onQuit={() => {}} />,
    { width: 160, height: 45 },
  );
  await renderOnce();
  mockInput.pressKey("k", { ctrl: true });
  await renderOnce();
  expect(captureCharFrame()).toContain("Saltar a…");
  await mockInput.typeText("memes");
  await renderOnce();
  expect(captureCharFrame()).toContain("Mu Gondor › #🐸-memes");
  mockInput.pressEnter();
  await renderOnce();
  expect(store.getState().ui.selectedChannelId).toBe("920000000000000005");
  expect(captureCharFrame()).not.toContain("Saltar a…");

  mockInput.pressKey("k", { ctrl: true });
  await renderOnce();
  mockInput.pressKeys(["\u001b[27u"]);
  await renderOnce();
  expect(captureCharFrame()).not.toContain("Saltar a…");
});

test("gu jumps to the next unread channel", async () => {
  const store = buildDemoStore();
  const actions = demoActions(store);
  const { mockInput, renderOnce } = await testRender(() => <App store={store} actions={actions} onQuit={() => {}} />, {
    width: 160,
    height: 45,
  });
  await renderOnce();
  mockInput.pressKey("g");
  mockInput.pressKey("u");
  await renderOnce();
  expect(["920000000000000005", "920000000000000006"]).toContain(store.getState().ui.selectedChannelId!);
});
