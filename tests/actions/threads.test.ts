import { expect, test } from "bun:test";

import { createActions } from "../../src/actions";
import type { RestClient } from "../../src/rest/client";
import { createStore, emptyState } from "../../src/store/store";

const GUILD = "100000000000000001";
const ME = "100000000000000010";
const TEXT = "100000000000000002";
const FORUM = "100000000000000005";
const THREAD = "200000000000000001";
const POST = "200000000000000002";

const thread = (id: string, parent: string, archived = false) => ({
  id,
  guild_id: GUILD,
  parent_id: parent,
  type: 11,
  name: `hilo ${id}`,
  thread_metadata: { archived, locked: false },
});

function setup(responses: Record<string, unknown> = {}) {
  const store = createStore(emptyState());
  store.dispatch({
    type: "gw",
    t: "READY",
    d: {
      user: { id: ME, username: "user1" },
      users: [],
      guilds: [
        {
          id: GUILD,
          name: "guild1",
          owner_id: ME,
          roles: [],
          channels: [
            { id: TEXT, type: 0, name: "text", position: 0, parent_id: null, permission_overwrites: [] },
            { id: FORUM, type: 15, name: "forum", position: 1, parent_id: null, permission_overwrites: [] },
          ],
          threads: [thread(THREAD, TEXT), thread(POST, FORUM)],
          members: [],
        },
      ],
      private_channels: [],
      read_state: [],
      user_guild_settings: [],
    },
  });
  const requests: string[] = [];
  const sent: unknown[] = [];
  const rest: RestClient = {
    closed: false,
    request: async <T>(method: string, path: string): Promise<T> => {
      requests.push(`${method} ${path}`);
      const key = Object.keys(responses).find((prefix) => path.startsWith(prefix));
      return (key ? responses[key] : []) as T;
    },
  } as RestClient;
  const actions = createActions({ store, rest, gateway: { send: (op: number, d: unknown) => void sent.push({ op, d }) } });
  return { store, actions, requests, sent };
}

test("opening a thread fetches its messages and subscribes with the parent channel", async () => {
  const s = setup();
  await s.actions.openChannel(THREAD);
  expect(s.requests).toEqual([`GET /channels/${THREAD}/messages?limit=50`]);
  expect(JSON.stringify(s.sent)).toContain(`"channels":{"${TEXT}":[[0,99]]}`);
});

test("opening a forum or a forum post fetches no forum messages and sends no op 37 for the forum", async () => {
  const s = setup();
  await s.actions.openChannel(FORUM);
  expect(s.requests).toEqual([]);
  expect(s.sent).toEqual([]);
  expect(s.store.getState().ui.selectedChannelId).toBe(FORUM);
  await s.actions.openChannel(POST);
  expect(s.requests).toEqual([`GET /channels/${POST}/messages?limit=50`]);
  expect(s.sent).toEqual([]);
});

test("sending in a thread posts to the thread id", async () => {
  const s = setup({ [`/channels/${THREAD}/messages`]: { id: "300000000000000001" } });
  await s.actions.send(THREAD, "hola hilo");
  expect(s.requests).toContain(`POST /channels/${THREAD}/messages`);
});

test("loadArchivedPosts searches archived posts and pages with offset", async () => {
  const s = setup({ [`/channels/${FORUM}/threads/search`]: { threads: [thread("200000000000000009", FORUM, true)], has_more: true } });
  await s.actions.loadArchivedPosts!(FORUM);
  expect(s.requests[0]).toBe(
    `GET /channels/${FORUM}/threads/search?archived=true&sort_by=last_message_time&sort_order=desc&limit=25&offset=0`,
  );
  expect(s.store.getState().channels["200000000000000009"]?.thread?.archived).toBe(true);
  await s.actions.loadArchivedPosts!(FORUM);
  expect(s.requests[1]).toContain("offset=1");
});

test("loadArchivedPosts with the 202 'index not ready' answer shows a notice and stores nothing", async () => {
  const s = setup({ [`/channels/${FORUM}/threads/search`]: { message: "Index not yet available. Try again later", code: 110000, retry_after: 5 } });
  const before = Object.keys(s.store.getState().channels).length;
  await s.actions.loadArchivedPosts!(FORUM);
  expect(Object.keys(s.store.getState().channels).length).toBe(before);
  expect(Object.values(s.store.getState().notices).some((n) => n.text.includes("indexando"))).toBe(true);
});
