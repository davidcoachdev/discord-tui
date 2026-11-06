import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { reduce } from "../../src/store/reduce";
import { selectMessages } from "../../src/store/selectors";
import { emptyState } from "../../src/store/store";
import type { AppState } from "../../src/store/types";

const ready = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "fixtures", "gateway", "READY-1.json"), "utf8"),
);
const messageFixture = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "fixtures", "gateway", "MESSAGE_CREATE-1.json"), "utf8"),
);

const GUILD = "100000000000000001";
const CHANNEL = "100000000000000002";
const ME = "100000000000000010";

function baseState(): AppState {
  return reduce(emptyState(), { type: "gw", t: "READY", d: ready.d });
}

function message(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    channel_id: CHANNEL,
    guild_id: GUILD,
    author: { id: ME, username: "user1" },
    content: `mensaje ${id}`,
    timestamp: "2026-11-06T12:00:00.000000+00:00",
    edited_timestamp: null,
    attachments: [],
    embeds: [],
    mentions: [],
    mention_everyone: false,
    referenced_message: null,
    reactions: [],
    nonce: null,
    ...extra,
  };
}

function create(state: AppState, id: string, extra: Record<string, unknown> = {}): AppState {
  return reduce(state, { type: "gw", t: "MESSAGE_CREATE", d: message(id, extra) });
}

test("MESSAGE_CREATE appends and bumps channel last_message_id", () => {
  let state = baseState();
  state = create(state, "100000000000000100");
  expect(selectMessages(state, CHANNEL).map((m) => m.id)).toEqual(["100000000000000100"]);
  expect(state.channels[CHANNEL]?.lastMessageId).toBe("100000000000000100");
});

test("messages/page older prepends, dedupes by id and sets hasMoreBefore=false when fewer than 50", () => {
  let state = baseState();
  state = reduce(state, {
    type: "messages/page",
    channelId: CHANNEL,
    messages: [message("100000000000000102"), message("100000000000000103")] as any,
    mode: "latest",
  });
  state = reduce(state, {
    type: "messages/page",
    channelId: CHANNEL,
    messages: [message("100000000000000101"), message("100000000000000102")] as any,
    mode: "older",
  });

  expect(selectMessages(state, CHANNEL).map((m) => m.id)).toEqual([
    "100000000000000101",
    "100000000000000102",
    "100000000000000103",
  ]);
  expect(state.messages[CHANNEL]!.hasMoreBefore).toBe(false);
});

test("messages/page latest merges without duplicates", () => {
  let state = baseState();
  state = reduce(state, {
    type: "messages/page",
    channelId: CHANNEL,
    messages: [message("100000000000000101")] as any,
    mode: "latest",
  });
  state = reduce(state, {
    type: "messages/page",
    channelId: CHANNEL,
    messages: [message("100000000000000101"), message("100000000000000102")] as any,
    mode: "latest",
  });
  expect(selectMessages(state, CHANNEL).map((m) => m.id)).toEqual([
    "100000000000000101",
    "100000000000000102",
  ]);
});

test("ring keeps the newest 500", () => {
  let state = baseState();
  const ids: string[] = [];
  for (let index = 0; index < 600; index += 1) {
    const id = String(100000000000000000n + BigInt(index));
    ids.push(id);
    state = create(state, id);
  }
  const messages = selectMessages(state, CHANNEL);
  expect(messages).toHaveLength(500);
  expect(messages[0]!.id).toBe(ids[100]!);
});

test("update/delete of a message outside the ring is ignored", () => {
  let state = baseState();
  const ids: string[] = [];
  for (let index = 0; index < 600; index += 1) {
    const id = String(100000000000000000n + BigInt(index));
    ids.push(id);
    state = create(state, id);
  }
  const before = selectMessages(state, CHANNEL);
  state = reduce(state, { type: "gw", t: "MESSAGE_UPDATE", d: { id: ids[0], channel_id: CHANNEL, content: "viejo" } });
  state = reduce(state, { type: "gw", t: "MESSAGE_DELETE", d: { id: ids[0], channel_id: CHANNEL } });
  expect(selectMessages(state, CHANNEL)).toHaveLength(500);
  expect(selectMessages(state, CHANNEL)[0]!.id).toBe(before[0]!.id);
});

test("MESSAGE_UPDATE without content keeps the old content", () => {
  let state = baseState();
  state = create(state, "100000000000000100", { content: "hola" });
  state = reduce(state, {
    type: "gw",
    t: "MESSAGE_UPDATE",
    d: { id: "100000000000000100", channel_id: CHANNEL, embeds: [{ type: "rich", title: "x" }] },
  });
  const messages = selectMessages(state, CHANNEL);
  expect(messages[0]!.content).toBe("hola");
  expect(messages[0]!.embeds).toHaveLength(1);
});

test("mentionsMe is true for <@me>, @everyone and replies to me", () => {
  let state = baseState();
  state = create(state, "100000000000000100", { content: `hola <@${ME}>` });
  expect(selectMessages(state, CHANNEL)[0]!.mentionsMe).toBe(true);

  state = create(state, "100000000000000101", { content: "@everyone", mention_everyone: true });
  expect(selectMessages(state, CHANNEL)[1]!.mentionsMe).toBe(true);

  state = create(state, "100000000000000102", {
    content: "respuesta",
    referenced_message: { id: "100000000000000100", author: { id: ME }, content: "hola" },
  });
  expect(selectMessages(state, CHANNEL)[2]!.mentionsMe).toBe(true);

  state = create(state, "100000000000000103", { content: "nada" });
  expect(selectMessages(state, CHANNEL)[3]!.mentionsMe).toBe(false);
});

test("MESSAGE_CREATE from fixture parses attachments, embeds and custom emoji content", () => {
  const state = reduce(baseState(), { type: "gw", t: "MESSAGE_CREATE", d: messageFixture.d });
  const messages = selectMessages(state, CHANNEL);
  const parsed = messages.find((m) => m.id === messageFixture.d.id)!;
  expect(parsed.attachments).toHaveLength(1);
  expect(parsed.embeds).toHaveLength(1);
  expect(parsed.reactions[0]?.emoji.name).toBe("partyparrot");
  expect(parsed.content).toBe("hola");
});
