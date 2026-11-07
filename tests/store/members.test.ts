import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildGuildSubscription } from "../../src/gateway/subscriptions";
import { createActions } from "../../src/actions";
import { selectMemberRows, selectTyping } from "../../src/store/selectors";
import { createStore, emptyState } from "../../src/store/store";
import { shapeOf } from "../helpers/shape";

const read = (...p: string[]) => JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "fixtures", ...p), "utf8"));
const GUILD = "100000000000000001";
const CHANNEL = "100000000000000002";

test("buildGuildSubscription has the same shape as the captured op 37", () => {
  expect(shapeOf(buildGuildSubscription(GUILD, CHANNEL))).toEqual(shapeOf(read("browser", "op37.json")));
});

test("opening a channel of a guild sends one op 37; reopening the same does not", async () => {
  const store = createStore(emptyState());
  store.dispatch({ type: "gw", t: "READY", d: read("gateway", "READY-1.json").d });
  const sent: { op: number; d: any }[] = [];
  const actions = createActions({
    store,
    rest: { closed: false, request: async () => [] as never },
    gateway: { send: (op: number, d: unknown) => void sent.push({ op, d }) },
  });
  await actions.openChannel(CHANNEL);
  store.dispatch({ type: "messages/staleAll" });
  await actions.openChannel(CHANNEL);
  expect(sent.filter((p) => p.op === 37)).toHaveLength(1);
  expect(Object.keys(sent[0]!.d.subscriptions)).toEqual([GUILD]);
});

test("SYNC then INSERT/DELETE keep groups and members in order", () => {
  const store = createStore(emptyState());
  store.dispatch({ type: "gw", t: "GUILD_MEMBER_LIST_UPDATE", d: read("gateway", "GUILD_MEMBER_LIST_UPDATE-1.json").d });
  const first = store.getState().memberLists[GUILD]!;
  expect(first.filter((r) => r.kind === "member").length).toBeGreaterThanOrEqual(2);
  store.dispatch({
    type: "gw",
    t: "GUILD_MEMBER_LIST_UPDATE",
    d: { guild_id: GUILD, ops: [{ op: "INSERT", index: 0, item: { member: { user: { id: "99", username: "nuevo" }, roles: [] } } }, { op: "DELETE", index: 1 }] },
  });
  const next = store.getState().memberLists[GUILD]!;
  expect(next[0]).toEqual({ kind: "member", userId: "99" });
  expect(next.length).toBe(first.length);
  expect(store.getState().users["99"]?.username).toBe("nuevo");
});

test("presence update changes the member's status in the rows", () => {
  const store = createStore(emptyState());
  store.dispatch({ type: "gw", t: "GUILD_MEMBER_LIST_UPDATE", d: read("gateway", "GUILD_MEMBER_LIST_UPDATE-1.json").d });
  store.dispatch({ type: "gw", t: "PRESENCE_UPDATE", d: read("gateway", "PRESENCE_UPDATE-1.json").d });
  const row = selectMemberRows(store.getState(), GUILD).find((r) => r.kind === "member" && r.userId === "100000000000000011");
  expect(row).toMatchObject({ status: "idle" });
});

test("typing expires after 10 s, excludes me and is cleared by the author's message", () => {
  const store = createStore(emptyState());
  store.dispatch({ type: "gw", t: "READY", d: { user: { id: "100000000000000010", username: "me" }, guilds: [] } });
  const typing = read("gateway", "TYPING_START-1.json").d;
  store.dispatch({ type: "gw", t: "TYPING_START", d: typing });
  store.dispatch({ type: "gw", t: "TYPING_START", d: { ...typing, user_id: "100000000000000010" } });
  const at = typing.timestamp * 1000;
  expect(selectTyping(store.getState(), CHANNEL, at + 1000)).toEqual(["100000000000000011"]);
  expect(selectTyping(store.getState(), CHANNEL, at + 11_000)).toEqual([]);
  store.dispatch({ type: "gw", t: "MESSAGE_CREATE", d: { id: "5", channel_id: CHANNEL, author: { id: "100000000000000011" }, content: "x" } });
  expect(selectTyping(store.getState(), CHANNEL, at + 1000)).toEqual([]);
});
