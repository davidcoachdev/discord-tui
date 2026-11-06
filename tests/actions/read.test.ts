import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createActions } from "../../src/actions";
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
