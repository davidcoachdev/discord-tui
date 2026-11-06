import { expect, test } from "bun:test";

import { canViewChannel } from "../../src/store/permissions";
import { reduce } from "../../src/store/reduce";
import { emptyState } from "../../src/store/store";

const GUILD = "100000000000000001";
const ME = "100000000000000010";
const CHANNEL = "100000000000000002";
const VIEW = 1 << 10;
const ADMIN = 1 << 3;

function stateFor(opts: {
  everyonePerms?: string;
  roleAPerms?: string;
  roleBPerms?: string;
  memberRoles?: string[];
  overwrites?: any[];
  ownerId?: string;
}) {
  const payload = {
    user: { id: ME, username: "user1" },
    users: [],
    guilds: [
      {
        id: GUILD,
        name: "guild1",
        owner_id: opts.ownerId ?? "999999999999999999",
        roles: [
          { id: GUILD, name: "@everyone", color: 0, position: 0, permissions: opts.everyonePerms ?? "0" },
          { id: "role-a", name: "A", color: 0, position: 1, permissions: opts.roleAPerms ?? "0" },
          { id: "role-b", name: "B", color: 0, position: 2, permissions: opts.roleBPerms ?? "0" },
        ],
        channels: [
          {
            id: CHANNEL,
            type: 0,
            name: "canal",
            position: 0,
            parent_id: null,
            permission_overwrites: opts.overwrites ?? [],
          },
        ],
        members: [{ user_id: ME, roles: opts.memberRoles ?? ["role-a"] }],
        emojis: [],
        presences: [],
      },
    ],
    private_channels: [],
    read_state: [],
    user_guild_settings: [],
  };

  return reduce(emptyState(), { type: "gw", t: "READY", d: payload });
}

test("hidden when @everyone lacks VIEW_CHANNEL", () => {
  const state = stateFor({ everyonePerms: "0", memberRoles: [] });
  expect(canViewChannel(state, GUILD, CHANNEL)).toBe(false);
});

test("role allow beats @everyone deny", () => {
  const state = stateFor({
    everyonePerms: String(VIEW),
    roleAPerms: String(VIEW),
    overwrites: [
      { id: GUILD, type: 0, allow: "0", deny: String(VIEW) },
      { id: "role-a", type: 0, allow: String(VIEW), deny: "0" },
    ],
  });
  expect(canViewChannel(state, GUILD, CHANNEL)).toBe(true);
});

test("member deny beats role allow", () => {
  const state = stateFor({
    everyonePerms: String(VIEW),
    roleAPerms: String(VIEW),
    overwrites: [
      { id: "role-a", type: 0, allow: String(VIEW), deny: "0" },
      { id: ME, type: 1, allow: "0", deny: String(VIEW) },
    ],
  });
  expect(canViewChannel(state, GUILD, CHANNEL)).toBe(false);
});

test("administrator sees every channel", () => {
  const state = stateFor({
    everyonePerms: "0",
    roleBPerms: String(ADMIN),
    memberRoles: ["role-b"],
    overwrites: [{ id: GUILD, type: 0, allow: "0", deny: String(VIEW) }],
  });
  expect(canViewChannel(state, GUILD, CHANNEL)).toBe(true);
});

test("guild owner sees every channel", () => {
  const state = stateFor({
    everyonePerms: "0",
    memberRoles: [],
    ownerId: ME,
    overwrites: [{ id: GUILD, type: 0, allow: "0", deny: String(VIEW) }],
  });
  expect(canViewChannel(state, GUILD, CHANNEL)).toBe(true);
});
