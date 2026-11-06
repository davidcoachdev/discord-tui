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
const ME = "100000000000000010";

function message(id: string, content: string, timestamp: string) {
  return {
    id,
    channel_id: CHANNEL,
    guild_id: GUILD,
    author: { id: ME, username: "user1" },
    content,
    timestamp,
    edited_timestamp: null,
    attachments: [],
    embeds: [],
    mentions: [],
    mention_everyone: false,
    referenced_message: null,
    reactions: [],
  };
}

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
      message("100000000000000100", "hola", "2026-11-06T12:00:00.000000+00:00"),
      message("100000000000000101", "respuesta", "2026-11-06T12:01:00.000000+00:00"),
    ] as any,
    mode: "latest",
  });

  const calls: string[] = [];
  const actions: Actions = {
    selectGuild: (id) => calls.push(`guild ${id}`),
    openChannel: async (id) => {
      calls.push(`open ${id}`);
    },
    loadOlder: async () => {},
    focus: (focus) => calls.push(`focus ${focus}`),
    toggleMembers: () => {},
  };
  return { store, actions, calls };
}

test("lists guilds with Mensajes directos first and the channel tree", async () => {
  const { store, actions } = setup();
  const { captureCharFrame, renderOnce } = await testRender(() => <App store={store} actions={actions} onQuit={() => {}} />, {
    width: 120,
    height: 30,
  });
  await renderOnce();
  const frame = captureCharFrame();

  for (const text of ["Mensajes directos", "guild1", "channel1", "hola", "respuesta", "conectado", "logueado como user1"]) {
    expect(frame).toContain(text);
  }
});

test("l opens the selected channel when the channel column is focused", async () => {
  const { store, actions, calls } = setup();
  const { mockInput, renderOnce } = await testRender(() => <App store={store} actions={actions} onQuit={() => {}} />, {
    width: 120,
    height: 30,
  });
  await renderOnce();
  mockInput.pressKey("l");
  await renderOnce();
  expect(calls).toContain(`open ${CHANNEL}`);
});

test("status bar reflects reconnecting", async () => {
  const { store, actions } = setup();
  const { captureCharFrame, renderOnce } = await testRender(() => <App store={store} actions={actions} onQuit={() => {}} />, {
    width: 120,
    height: 30,
  });
  store.dispatch({ type: "connection", status: "reconnecting" });
  await renderOnce();
  expect(captureCharFrame()).toContain("reconectando…");
});
