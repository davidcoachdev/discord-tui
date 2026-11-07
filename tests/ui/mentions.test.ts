import { expect, test } from "bun:test";

import { emptyState } from "../../src/store/store";
import type { AppState } from "../../src/store/types";
import { applyPick, mentionCandidates, mentionQueryAt, serializeComposer, shiftMentions } from "../../src/ui/mentions";

function user(id: string, username: string, globalName: string | null = null) {
  return { id, username, globalName, avatar: null, bot: false };
}

function state(): AppState {
  const s = emptyState();
  s.me = { id: "1", username: "yo" };
  s.users = {
    "1": user("1", "yo"),
    "2": user("2", "gonza", "Gon"),
    "3": user("3", "lucia"),
    "4": user("4", "goku"),
    "5": user("5", "zeta"),
  };
  s.channels = {
    c: { id: "c", guildId: "g", name: "general", type: 0, position: 0, parentId: null, permissionOverwrites: [], lastMessageId: null },
  };
  s.members = {
    g: {
      "1": { userId: "1", guildId: "g", roles: [], nick: null },
      "2": { userId: "2", guildId: "g", roles: [], nick: null },
      "3": { userId: "3", guildId: "g", roles: [], nick: "Lu" },
    },
  };
  s.messages = {
    c: {
      ids: ["m1"],
      byId: { m1: { id: "m1", author: { id: "4" } } as any },
      hasMoreBefore: false,
      loadingOlder: false,
      stale: false,
    },
  };
  return s;
}

test("mentionQueryAt finds @word before the cursor", () => {
  expect(mentionQueryAt("hola @go", 8)).toEqual({ start: 5, query: "go" });
  expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
  expect(mentionQueryAt("mail@go", 7)).toBeNull();
  expect(mentionQueryAt("hola @go y", 10)).toBeNull();
  expect(mentionQueryAt("@a.b-c_d", 8)).toEqual({ start: 0, query: "a.b-c_d" });
});

test("candidates rank by fuzzyScore and include recent authors", () => {
  const s = state();
  const go = mentionCandidates(s, "c", "go");
  expect(go.map((c) => c.userId).sort()).toEqual(["2", "4"]);
  expect(go.find((c) => c.userId === "2")).toEqual({ userId: "2", label: "Gon", secondary: "gonza" });
  expect(mentionCandidates(s, "c", "lu")).toEqual([{ userId: "3", label: "Lu", secondary: "lucia" }]);
  const all = mentionCandidates(s, "c", "");
  expect(all.map((c) => c.userId)).not.toContain("1");
  expect(new Set(all.map((c) => c.userId)).size).toBe(all.length);
  expect(all.find((c) => c.userId === "4")).toEqual({ userId: "4", label: "goku", secondary: null });
});

test("applyPick replaces the query and records the range", () => {
  const picked = applyPick("hola @go", 5, 8, "Gon", "2", []);
  expect(picked).toEqual({ text: "hola @Gon ", cursor: 10, mentions: [{ start: 5, end: 9, userId: "2" }] });
  expect(serializeComposer(picked.text, picked.mentions)).toBe("hola <@2> ");
});

test("serializeComposer converts only picked mentions", () => {
  expect(serializeComposer("hola @gon y @nadie", [{ start: 5, end: 9, userId: "7" }])).toBe("hola <@7> y @nadie");
  expect(serializeComposer("hola xgon", [{ start: 5, end: 9, userId: "7" }])).toBe("hola xgon");
});

test("editing text before a mention shifts its range", () => {
  const mentions = [{ start: 5, end: 9, userId: "7" }];
  expect(shiftMentions(mentions, 0, 2)).toEqual([{ start: 7, end: 11, userId: "7" }]);
  expect(shiftMentions(mentions, 2, -1)).toEqual([{ start: 4, end: 8, userId: "7" }]);
  expect(shiftMentions(mentions, 12, 3)).toEqual(mentions);
  expect(shiftMentions(mentions, 7, 1)).toEqual([]);
  expect(shiftMentions(mentions, 4, -2)).toEqual([]);
});
