import { expect, test } from "bun:test";

import { reduce } from "../../src/store/reduce";
import { isChannelUnread, selectChannelList, selectNextUnread } from "../../src/store/selectors";
import { emptyState } from "../../src/store/store";

const GUILD = "100000000000000001";
const ME = "100000000000000010";
const A = "100000000000000002";
const B = "100000000000000003";

function stateWith(opts: { readState?: any[]; settings?: any[]; lastA?: string; lastB?: string } = {}) {
  const payload = {
    user: { id: ME, username: "user1" },
    users: [],
    guilds: [
      {
        id: GUILD,
        name: "guild1",
        owner_id: ME,
        roles: [{ id: GUILD, name: "@everyone", color: 0, position: 0, permissions: String(1 << 10) }],
        channels: [
          { id: A, type: 0, name: "a", position: 0, parent_id: null, permission_overwrites: [], last_message_id: opts.lastA ?? null },
          { id: B, type: 0, name: "b", position: 1, parent_id: null, permission_overwrites: [], last_message_id: opts.lastB ?? null },
        ],
        members: [{ user_id: ME, roles: [] }],
        emojis: [],
        presences: [],
      },
    ],
    private_channels: [],
    read_state: opts.readState ?? [],
    user_guild_settings: opts.settings ?? [],
  };

  return { state: reduce(emptyState(), { type: "gw", t: "READY", d: payload }), guildId: GUILD, A, B };
}

test("unread when last_message_id > lastAckedId", () => {
  const { state } = stateWith({
    lastA: "100000000000000030",
    lastB: "100000000000000020",
    readState: [{ id: B, last_message_id: "100000000000000010" }],
  });
  expect(isChannelUnread(state, A)).toBe(true);
  expect(isChannelUnread(state, B)).toBe(true);
});

test("read channel is not unread", () => {
  const { state } = stateWith({ lastA: "100000000000000030", readState: [{ id: A, last_message_id: "100000000000000030" }] });
  expect(isChannelUnread(state, A)).toBe(false);
});

test("muted channel is not returned by selectNextUnread", () => {
  const { state } = stateWith({
    lastA: "100000000000000030",
    lastB: "100000000000000020",
    readState: [{ id: B, last_message_id: "100000000000000010" }],
    settings: [{ guild_id: GUILD, muted: false, channel_overrides: [{ channel_id: A, muted: true }] }],
  });

  expect(selectNextUnread(state, null)).toBe(B);
  expect(selectChannelList(state, GUILD).find((row) => row.id === A)?.muted).toBe(true);
});

test("selectNextUnread returns null when everything is read or muted", () => {
  const { state } = stateWith({
    lastA: "100000000000000030",
    readState: [
      { id: A, last_message_id: "100000000000000030" },
      { id: B, last_message_id: "100000000000000020" },
    ],
  });
  expect(selectNextUnread(state, null)).toBeNull();
});
