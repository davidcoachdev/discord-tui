import { expect, test } from "bun:test";

import { reduce } from "../../src/store/reduce";
import {
  isChannelUnread,
  selectChannelList,
  selectForumPosts,
  selectVisibleChannelList,
} from "../../src/store/selectors";
import { emptyState } from "../../src/store/store";
import type { AppState } from "../../src/store/types";

const GUILD = "100000000000000001";
const ME = "100000000000000010";
const CAT = "100000000000000050";
const TEXT = "100000000000000002";
const HIDDEN = "100000000000000003";
const LOOSE = "100000000000000004";
const FORUM = "100000000000000005";
const MEDIA = "100000000000000006";
const VIEW = String(1 << 10);

const chan = (id: string, type: number, name: string, position: number, parent: string | null = null, overwrites: any[] = []) => ({
  id,
  type,
  name,
  position,
  parent_id: parent,
  permission_overwrites: overwrites,
  last_message_id: null,
});

const thread = (id: string, parent: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  guild_id: GUILD,
  parent_id: parent,
  type: 11,
  name,
  owner_id: ME,
  last_message_id: null,
  message_count: 3,
  member_count: 2,
  thread_metadata: { archived: false, locked: false, auto_archive_duration: 1440, archive_timestamp: "2026-11-07T00:00:00.000Z" },
  ...extra,
});

function ready(threads: unknown[] = []): AppState {
  return reduce(emptyState(), {
    type: "gw",
    t: "READY",
    d: {
      user: { id: ME, username: "user1" },
      users: [],
      guilds: [
        {
          id: GUILD,
          name: "guild1",
          owner_id: "100000000000000099",
          roles: [{ id: GUILD, name: "@everyone", color: 0, position: 0, permissions: VIEW }],
          channels: [
            chan(CAT, 4, "cat", 0),
            chan(TEXT, 0, "text", 0, CAT),
            chan(HIDDEN, 0, "hidden", 1, CAT, [{ id: GUILD, type: 0, allow: "0", deny: VIEW }]),
            chan(FORUM, 15, "forum", 2, CAT),
            chan(MEDIA, 16, "media", 3, CAT),
            chan(LOOSE, 0, "loose", 0),
          ],
          threads,
          members: [{ user_id: ME, roles: [] }],
          emojis: [],
          presences: [],
        },
      ],
      private_channels: [],
      read_state: [],
      user_guild_settings: [],
    },
  });
}

const gw = (state: AppState, t: string, d: unknown): AppState => reduce(state, { type: "gw", t, d });

test("READY guilds[].threads are stored with parent, flags and counts", () => {
  const state = ready([thread("200000000000000001", TEXT, "hilo", { last_message_id: "300000000000000001" })]);
  const stored = state.channels["200000000000000001"]!;
  expect(stored.parentId).toBe(TEXT);
  expect(stored.guildId).toBe(GUILD);
  expect(stored.lastMessageId).toBe("300000000000000001");
  expect(stored.thread).toEqual({ archived: false, locked: false, ownerId: ME, messageCount: 3, memberCount: 2 });
});

test("THREAD_CREATE adds a thread; THREAD_UPDATE keeps last_message_id and changes flags", () => {
  let state = gw(ready(), "THREAD_CREATE", { ...thread("200000000000000001", TEXT, "nuevo", { last_message_id: "300000000000000005" }), newly_created: true });
  expect(state.channels["200000000000000001"]?.name).toBe("nuevo");
  state = gw(state, "THREAD_UPDATE", {
    id: "200000000000000001",
    guild_id: GUILD,
    parent_id: TEXT,
    type: 11,
    name: "renombrado",
    thread_metadata: { archived: true, locked: true },
  });
  const stored = state.channels["200000000000000001"]!;
  expect(stored.name).toBe("renombrado");
  expect(stored.lastMessageId).toBe("300000000000000005");
  expect(stored.thread?.archived).toBe(true);
  expect(stored.thread?.locked).toBe(true);
  expect(stored.thread?.messageCount).toBe(3);
});

test("CHANNEL_CREATE / CHANNEL_UPDATE with a thread type are stored as threads", () => {
  const state = gw(ready(), "CHANNEL_CREATE", thread("200000000000000002", TEXT, "por channel"));
  expect(state.channels["200000000000000002"]?.thread).toBeDefined();
  expect(state.channels["200000000000000002"]?.parentId).toBe(TEXT);
});

test("THREAD_DELETE removes the thread and its messages and clears the selection", () => {
  let state = ready([thread("200000000000000001", TEXT, "hilo")]);
  state = reduce(state, { type: "ui/selectChannel", id: "200000000000000001" });
  state = reduce(state, { type: "messages/page", channelId: "200000000000000001", messages: [], mode: "latest" });
  state = gw(state, "THREAD_DELETE", { id: "200000000000000001", guild_id: GUILD, parent_id: TEXT, type: 11 });
  expect(state.channels["200000000000000001"]).toBeUndefined();
  expect(state.messages["200000000000000001"]).toBeUndefined();
  expect(state.ui.selectedChannelId).toBeNull();
});

test("THREAD_DELETE does not delete a normal channel", () => {
  const state = gw(ready(), "THREAD_DELETE", { id: TEXT, guild_id: GUILD, type: 0 });
  expect(state.channels[TEXT]).toBeDefined();
});

test("THREAD_LIST_SYNC replaces active threads only for the given channel_ids", () => {
  let state = ready([
    thread("200000000000000001", TEXT, "viejo de text"),
    thread("200000000000000002", LOOSE, "de loose"),
    thread("200000000000000003", TEXT, "archivado", { thread_metadata: { archived: true, locked: false } }),
  ]);
  state = gw(state, "THREAD_LIST_SYNC", {
    guild_id: GUILD,
    channel_ids: [TEXT, FORUM],
    threads: [thread("200000000000000010", TEXT, "nuevo de text"), thread("200000000000000011", FORUM, "post")],
    members: [],
  });
  expect(state.channels["200000000000000001"]).toBeUndefined();
  expect(state.channels["200000000000000002"]?.name).toBe("de loose");
  expect(state.channels["200000000000000003"]?.name).toBe("archivado");
  expect(state.channels["200000000000000010"]?.name).toBe("nuevo de text");
  expect(state.channels["200000000000000011"]?.parentId).toBe(FORUM);
});

test("THREAD_LIST_SYNC without channel_ids replaces the whole guild, but keeps the open thread", () => {
  let state = ready([thread("200000000000000001", TEXT, "a"), thread("200000000000000002", LOOSE, "b")]);
  state = reduce(state, { type: "ui/selectChannel", id: "200000000000000002" });
  state = gw(state, "THREAD_LIST_SYNC", { guild_id: GUILD, threads: [thread("200000000000000003", LOOSE, "c")] });
  expect(state.channels["200000000000000001"]).toBeUndefined();
  expect(state.channels["200000000000000002"]).toBeDefined();
  expect(state.channels["200000000000000003"]).toBeDefined();
});

test("malformed thread payloads leave the state unchanged", () => {
  const state = ready([thread("200000000000000001", TEXT, "a")]);
  for (const t of ["THREAD_CREATE", "THREAD_UPDATE", "THREAD_DELETE", "THREAD_LIST_SYNC", "CHANNEL_CREATE"]) {
    for (const d of [null, undefined, 5, "x", [], {}, { id: 3 }, { id: "200000000000000009", type: 11 }, { guild_id: 7, threads: "x" }]) {
      expect(gw(state, t, d)).toBe(state);
    }
  }
  // Hilos inválidos dentro de un sync válido se ignoran sin romper.
  const synced = gw(state, "THREAD_LIST_SYNC", { guild_id: GUILD, channel_ids: "nope", threads: [null, { id: 1 }, thread("200000000000000004", TEXT, "ok")] });
  expect(synced.channels["200000000000000004"]?.name).toBe("ok");
  // READY con threads rotos no rompe.
  expect(() => ready([null, 3, { id: "x" }] as unknown[])).not.toThrow();
});

test("threads appear indented under their text channel, newest activity first", () => {
  const state = ready([
    thread("200000000000000001", TEXT, "viejo", { last_message_id: "300000000000000001" }),
    thread("200000000000000002", TEXT, "nuevo", { last_message_id: "300000000000000009" }),
    thread("200000000000000003", TEXT, "archivado", { thread_metadata: { archived: true } }),
    thread("200000000000000004", LOOSE, "suelto"),
    thread("200000000000000005", FORUM, "post"),
  ]);
  const rows = selectChannelList(state, GUILD).map((row) => `${row.depth}:${row.kind}:${row.name}`);
  expect(rows).toEqual([
    "0:category:cat",
    "1:text:text",
    "2:thread:nuevo",
    "2:thread:viejo",
    "1:forum:forum",
    "1:media:media",
    "0:text:loose",
    "1:thread:suelto",
  ]);
});

test("a thread of a hidden channel is not visible", () => {
  const state = ready([thread("200000000000000001", HIDDEN, "secreto")]);
  expect(selectChannelList(state, GUILD).some((row) => row.name === "secreto")).toBe(false);
});

test("threads collapse together with the category of their channel", () => {
  let state = ready([thread("200000000000000001", TEXT, "en cat"), thread("200000000000000002", LOOSE, "suelto")]);
  state = reduce(state, { type: "ui/toggleCategory", id: CAT });
  const names = selectVisibleChannelList(state, GUILD).map((row) => row.name);
  expect(names).toEqual(["cat", "loose", "suelto"]);
});

test("a thread is unread only if it has a read state (joined), like Discord", () => {
  let state = ready([thread("200000000000000001", TEXT, "a", { last_message_id: "300000000000000009" })]);
  expect(isChannelUnread(state, "200000000000000001")).toBe(false);
  state = gw(state, "MESSAGE_ACK", { channel_id: "200000000000000001", message_id: "300000000000000001" });
  expect(isChannelUnread(state, "200000000000000001")).toBe(true);
});

test("forum posts: active newest first, then archived; threads/loaded adds archived posts", () => {
  let state = ready([
    thread("200000000000000001", FORUM, "viejo", { last_message_id: "300000000000000001" }),
    thread("200000000000000002", FORUM, "nuevo", { last_message_id: "300000000000000009" }),
  ]);
  state = reduce(state, {
    type: "threads/loaded",
    guildId: GUILD,
    threads: [thread("200000000000000003", FORUM, "archivado", { thread_metadata: { archived: true, locked: true } }), null],
  });
  expect(selectForumPosts(state, FORUM).map((post) => `${post.name}:${post.archived}`)).toEqual([
    "nuevo:false",
    "viejo:false",
    "archivado:true",
  ]);
});
