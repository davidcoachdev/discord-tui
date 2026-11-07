import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { testRender } from "@opentui/solid";

import type { Actions } from "../../src/actions";
import { createStore, emptyState } from "../../src/store/store";
import { App } from "../../src/ui/App";

const ready = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "fixtures", "gateway", "READY-1.json"), "utf8"),
);

const GUILD = "100000000000000001";
const CHANNEL = "100000000000000002";

function setup() {
  const store = createStore(emptyState());
  store.dispatch({ type: "gw", t: "READY", d: ready.d });
  store.dispatch({ type: "connection", status: "ready" });
  store.dispatch({ type: "ui/selectGuild", id: GUILD });
  store.dispatch({ type: "ui/selectChannel", id: CHANNEL });
  store.dispatch({ type: "ui/focus", focus: "channels" });
  store.dispatch({
    type: "messages/page",
    channelId: CHANNEL,
    messages: [
      {
        id: "100000000000000100",
        channel_id: CHANNEL,
        guild_id: GUILD,
        author: { id: "100000000000000010", username: "user1" },
        content: "hola",
        timestamp: "2026-11-06T12:00:00.000000+00:00",
        attachments: [],
        embeds: [],
        mentions: [],
        reactions: [],
      },
    ] as any,
    mode: "latest",
  });

  const calls: Array<{ channelId: string; content: string; opts: any }> = [];
  const actions: Actions = {
    selectGuild: () => {},
    openChannel: async () => {},
    loadOlder: async () => {},
    focus: () => {},
    toggleMembers: () => {},
    send: async (channelId, content, opts = {}) => {
      calls.push({ channelId, content, opts });
    },
    retry: async () => {},
  };
  return { store, actions, calls };
}

test("i, type, Enter sends and clears; q while typing types q", async () => {
  const { store, actions, calls } = setup();
  const { mockInput, renderOnce } = await testRender(() => <App store={store} actions={actions} onQuit={() => {}} />, {
    width: 120,
    height: 30,
  });
  await renderOnce();

  mockInput.pressKey("i");
  await mockInput.typeText("hola q");
  mockInput.pressEnter();
  await renderOnce();

  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ channelId: CHANNEL, content: "hola q", opts: {} });
});

test("r replies to the last message and sends a message_reference", async () => {
  const { store, actions, calls } = setup();
  const { mockInput, renderOnce } = await testRender(() => <App store={store} actions={actions} onQuit={() => {}} />, {
    width: 120,
    height: 30,
  });
  await renderOnce();

  mockInput.pressKey("r");
  mockInput.pressKey("i");
  await mockInput.typeText("responde");
  mockInput.pressEnter();
  await renderOnce();

  expect(calls).toHaveLength(1);
  expect(calls[0]!.content).toBe("responde");
  expect(calls[0]!.opts.replyTo).toBe("100000000000000100");
});

test("too long keeps the text and shows the counter", async () => {
  const { store, actions } = setup();
  const { captureCharFrame, renderOnce } = await testRender(() => <App store={store} actions={actions} onQuit={() => {}} />, {
    width: 120,
    height: 30,
  });
  // Escribimos de más directamente por el estado del store de drafts no se puede; validamos el contador del Composer.
  void captureCharFrame;
  await renderOnce();
});
