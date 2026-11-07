import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { emptyState } from "../../src/store/store";
import { reduce } from "../../src/store/reduce";
import { selectChannelList } from "../../src/store/selectors";
import { compareSnowflakes } from "../../src/util/snowflake";

const ready = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "fixtures", "gateway", "READY-1.json"), "utf8"),
);

function reduceReady(payload: unknown) {
  return reduce(emptyState(), { type: "gw", t: "READY", d: payload });
}

function readyWithChannels(channels: any[], overrides: any = {}) {
  const payload = structuredClone(ready);
  payload.d.guilds[0].channels.push(...channels);
  Object.assign(payload.d.guilds[0], overrides);
  return payload;
}

test("READY fills me, guilds, channels, users (deduped) and read states", () => {
  const state = reduceReady(ready.d);
  expect(state.me?.id).toBe(ready.d.user.id);
  expect(state.guildOrder).toHaveLength(ready.d.guilds.length);
  expect(Object.keys(state.users).length).toBeGreaterThan(0);
  expect(state.readState["100000000000000002"]?.lastAckedId).toBe("100000000000000021");
});

test("DMs come from private_channels", () => {
  const state = reduceReady(ready.d);
  const rows = selectChannelList(state, "@dms");
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => row.kind === "dm" || row.kind === "group_dm")).toBe(true);
});

test("channel list skips threads, forums and stage, and nests under categories by position", () => {
  const category = { id: "100000000000000060", type: 4, name: "categoria", position: 0, parent_id: null, permission_overwrites: [] };
  const child = { id: "100000000000000061", type: 0, name: "hijo", position: 2, parent_id: category.id, permission_overwrites: [] };
  const thread = { id: "100000000000000062", type: 11, name: "hilo", position: 3, parent_id: category.id, permission_overwrites: [] };
  const forum = { id: "100000000000000063", type: 15, name: "foro", position: 4, parent_id: category.id, permission_overwrites: [] };
  const stage = { id: "100000000000000064", type: 13, name: "stage", position: 5, parent_id: category.id, permission_overwrites: [] };

  const state = reduceReady(readyWithChannels([category, child, thread, forum, stage]).d);
  const rows = selectChannelList(state, state.guildOrder[0]!);

  expect(rows.find((row) => row.id === category.id)).toMatchObject({ kind: "category", depth: 0 });
  expect(rows.find((row) => row.id === child.id)).toMatchObject({ kind: "text", depth: 1 });
  expect(rows.some((row) => row.id === thread.id)).toBe(false);
  expect(rows.some((row) => row.id === forum.id)).toBe(false);
  expect(rows.some((row) => row.id === stage.id)).toBe(false);
});

test("hidden channel is not listed", () => {
  const guildId = ready.d.guilds[0].id;
  const hidden = {
    id: "100000000000000065",
    type: 0,
    name: "oculto",
    position: 9,
    parent_id: null,
    permission_overwrites: [{ id: guildId, type: 0, allow: "0", deny: String(1 << 10) }],
  };

  const state = reduceReady(readyWithChannels([hidden], { owner_id: "999999999999999999" }).d);
  const rows = selectChannelList(state, guildId);
  expect(rows.some((row) => row.id === hidden.id)).toBe(false);
});

test("compareSnowflakes compares as BigInt", () => {
  expect(compareSnowflakes("99", "100")).toBe(-1);
  expect(compareSnowflakes("100", "99")).toBe(1);
  expect(compareSnowflakes("100", "100")).toBe(0);
});

test("READY also accepts object-shaped maps for read_state, settings and private_channels", () => {
  const payload = structuredClone(ready);
  payload.d.read_state = {
    "100000000000000002": { last_message_id: "100000000000000021", mention_count: 2 },
  };
  payload.d.user_guild_settings = {
    "100000000000000001": { muted: true, channel_overrides: { "100000000000000002": { muted: true } } },
  };

  const state = reduceReady(payload.d);
  expect(state.readState["100000000000000002"]).toEqual({
    lastAckedId: "100000000000000021",
    mentionCount: 2,
  });
  expect(state.guildSettings.mutedGuilds).toContain("100000000000000001");
  expect(state.guildSettings.mutedChannels).toContain("100000000000000002");
});
