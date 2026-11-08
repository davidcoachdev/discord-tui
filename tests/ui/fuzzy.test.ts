import { expect, test } from "bun:test";

import { emptyState } from "../../src/store/store";
import type { AppState, ChannelState } from "../../src/store/types";
import { fuzzyScore, rankSwitcherItems } from "../../src/ui/fuzzy";

test("fuzzyScore matches subsequences and prefers word starts", () => {
  expect(fuzzyScore("gnr", "general")).not.toBeNull();
  expect(fuzzyScore("xyz", "general")).toBeNull();
  expect(fuzzyScore("gen", "general")!).toBeGreaterThan(fuzzyScore("gen", "big-energy")!);
  expect(fuzzyScore("canc", "canción")).not.toBeNull();
});

test("fuzzyScore ignores case and accents, empty query scores 0", () => {
  expect(fuzzyScore("CANCION", "Canción")).not.toBeNull();
  expect(fuzzyScore("", "lo que sea")).toBe(0);
  expect(fuzzyScore("gen", "Server › #general")!).toBeGreaterThan(fuzzyScore("gen", "Server › #big-energy")!);
});

const ME = "10";

function channel(id: string, guildId: string | null, name: string, type: number, position: number, last: string | null = null): ChannelState {
  return { id, guildId, name, type, position, parentId: null, permissionOverwrites: [], lastMessageId: last };
}

function state(): AppState {
  const s = emptyState();
  s.me = { id: ME, username: "yo" };
  s.guilds = {
    g1: { id: "g1", name: "Casa", icon: null, ownerId: ME, roles: [], emojis: [] },
  };
  s.guildOrder = ["g1"];
  s.channels = {
    "1": channel("1", "g1", "general", 0, 0),
    "2": channel("2", "g1", "big-energy", 0, 1, "50"),
    "3": channel("3", "g1", "charla", 2, 2),
    "4": channel("4", "g1", "Categoría", 4, 3),
    "5": channel("5", null, "lucia", 1, 0),
  };
  s.privateChannelIds = ["5"];
  return s;
}

test("empty query lists unread first, then original order, skipping categories", () => {
  expect(rankSwitcherItems(state(), "")).toEqual([
    { channelId: "2", label: "Casa › #big-energy", unread: true, kind: "text" },
    { channelId: "1", label: "Casa › #general", unread: false, kind: "text" },
    { channelId: "3", label: "Casa › 🔊 charla", unread: false, kind: "voice" },
    { channelId: "5", label: "@lucia", unread: false, kind: "dm" },
  ]);
});

test("query ranks by score and drops non matches", () => {
  const ids = rankSwitcherItems(state(), "gen").map((item) => item.channelId);
  expect(ids[0]).toBe("1");
  expect(ids).toContain("2");
  expect(ids).not.toContain("5");
  expect(rankSwitcherItems(state(), "luc").map((item) => item.channelId)).toEqual(["5"]);
});

test("at most 60 items (the switcher scrolls through them)", () => {
  const s = state();
  for (let i = 0; i < 80; i += 1) s.channels[`x${i}`] = channel(`x${i}`, "g1", `canal-${i}`, 0, 10 + i);
  expect(rankSwitcherItems(s, "")).toHaveLength(60);
});
