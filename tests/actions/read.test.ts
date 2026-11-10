import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createActions } from "../../src/actions";
import { createAckScheduler } from "../../src/actions/ack";
import type { Gateway } from "../../src/gateway/connection";
import type { RestClient } from "../../src/rest/client";
import { reduce } from "../../src/store/reduce";
import { emptyState, createStore } from "../../src/store/store";

const ready = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "fixtures", "gateway", "READY-1.json"), "utf8"),
);

const CHANNEL = "100000000000000002";
const gateway = { send() {} } as unknown as Gateway;

function storeWithOldest() {
  const store = createStore(emptyState());
  store.dispatch({ type: "gw", t: "READY", d: ready.d });
  store.dispatch({
    type: "messages/page",
    channelId: CHANNEL,
    messages: [
      {
        id: "100000000000000100",
        channel_id: CHANNEL,
        guild_id: "100000000000000001",
        author: { id: "100000000000000010", username: "user1" },
        content: "hola",
        timestamp: "2026-11-06T12:00:00+00:00",
        attachments: [],
        embeds: [],
        mentions: [],
        reactions: [],
      },
    ] as any,
    mode: "latest",
  });
  return store;
}

test("loadOlder sends one request even if called 5 times while in flight", async () => {
  const calls: string[] = [];
  let release!: (value: unknown) => void;
  const rest: RestClient = {
    closed: false,
    request: async <T>(method: string, path: string): Promise<T> => {
      calls.push(`${method} ${path}`);
      return new Promise<T>((resolve) => {
        release = resolve as (value: unknown) => void;
      });
    },
  };

  const store = storeWithOldest();
  const actions = createActions({ store, rest, gateway });

  const pending = [actions.loadOlder(CHANNEL), actions.loadOlder(CHANNEL), actions.loadOlder(CHANNEL)];
  expect(calls).toHaveLength(1);

  release([]);
  await Promise.all(pending);
  expect(calls).toHaveLength(1);
});

test("loadOlder uses before=<oldest id> and limit=50", async () => {
  const calls: string[] = [];
  const rest: RestClient = {
    closed: false,
    request: async <T>(method: string, path: string): Promise<T> => {
      calls.push(`${method} ${path}`);
      return [] as T;
    },
  };

  const store = storeWithOldest();
  const actions = createActions({ store, rest, gateway });
  await actions.loadOlder(CHANNEL);

  expect(calls[0]).toContain("before=100000000000000100");
  expect(calls[0]).toContain("limit=50");
  expect(store.getState().messages[CHANNEL]!.hasMoreBefore).toBe(false);
});

const GUILD_A = "100000000000000001";
const GUILD_B = "200000000000000001";
const CHAN_A = "100000000000000002";
const CHAN_B = "200000000000000002";

function twoGuildStore() {
  const store = createStore(emptyState());
  const channel = (id: string, name: string) => ({
    id,
    name,
    type: 0,
    position: 0,
    parent_id: null,
    permission_overwrites: [],
    last_message_id: null,
  });
  store.dispatch({
    type: "gw",
    t: "READY",
    d: {
      user: { id: "100000000000000010", username: "yo" },
      users: [],
      guilds: [
        { id: GUILD_A, properties: { name: "g1", owner_id: "100000000000000010" }, roles: [], channels: [channel(CHAN_A, "general-a")] },
        { id: GUILD_B, properties: { name: "g2", owner_id: "100000000000000010" }, roles: [], channels: [channel(CHAN_B, "general-b")] },
      ],
      private_channels: [],
      read_state: [],
      user_guild_settings: [],
    },
  });
  return store;
}

test("selectGuild on the initial selection opens the first channel and fetches history once", () => {
  const store = twoGuildStore();
  const calls: string[] = [];
  const rest: RestClient = {
    closed: false,
    request: async <T>(method: string, path: string): Promise<T> => {
      calls.push(`${method} ${path}`);
      return [] as T;
    },
  };
  const actions = createActions({ store, rest, gateway });

  actions.selectGuild(GUILD_A);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain(`/channels/${CHAN_A}/messages`);
  expect(store.getState().ui.selectedChannelId).toBe(CHAN_A);
});

test("selectGuild with a guild already selected switches without a GET", () => {
  const store = twoGuildStore();
  const calls: string[] = [];
  const rest: RestClient = {
    closed: false,
    request: async <T>(method: string, path: string): Promise<T> => {
      calls.push(`${method} ${path}`);
      return [] as T;
    },
  };
  const actions = createActions({ store, rest, gateway });

  actions.selectGuild(GUILD_A);
  expect(calls).toHaveLength(1);

  actions.selectGuild(GUILD_B);
  expect(calls).toHaveLength(1);
  expect(store.getState().ui.selectedGuildId).toBe(GUILD_B);
  expect(store.getState().ui.selectedChannelId).toBe(CHAN_B);
});

test("ack scheduler sends null first and reuses the token returned for the channel", async () => {
  let pending: (() => void) | null = null;
  const setTimer = ((fn: () => void, _ms: number) => {
    pending = fn;
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  const calls: Array<{ channelId: string; messageId: string; token: string | null }> = [];
  const returned = ["tok-1", "tok-2"];
  const postAck = async (channelId: string, messageId: string, token: string | null) => {
    calls.push({ channelId, messageId, token });
    return { token: returned.shift() ?? null };
  };

  const ack = createAckScheduler({ postAck, setTimer, debounceMs: 10 });

  ack.viewing("chan", "100000000000000001");
  expect(pending).not.toBeNull();
  await pending!();

  ack.viewing("chan", "100000000000000002");
  await pending!();

  expect(calls).toEqual([
    { channelId: "chan", messageId: "100000000000000001", token: null },
    { channelId: "chan", messageId: "100000000000000002", token: "tok-1" },
  ]);
});
