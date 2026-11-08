import { describe, expect, test } from "bun:test";

import { createActions, MEMBER_SCROLL_THROTTLE_MS } from "../../src/actions";
import { buildGuildSubscription, memberRangesUpTo, nextMemberRanges } from "../../src/gateway/subscriptions";
import { selectMemberRows } from "../../src/store/selectors";
import { createStore, emptyState, type Store } from "../../src/store/store";

const GUILD = "100000000000000001";
const CHANNEL = "100000000000000002";
const OTHER = "100000000000000003";

const member = (n: number) => ({ member: { user: { id: `u${n}`, username: `user${n}` }, roles: [] } });

/** SYNC de `count` filas desde `start`: un encabezado de grupo en `start` y miembros después. */
function sync(store: Store, start: number, count: number, extra: Record<string, unknown> = {}) {
  const items = Array.from({ length: count }, (_, i) =>
    i === 0 && start === 0 ? { group: { id: "online", count: 14000 } } : member(start + i),
  );
  store.dispatch({
    type: "gw",
    t: "GUILD_MEMBER_LIST_UPDATE",
    d: { guild_id: GUILD, id: "everyone", ops: [{ op: "SYNC", range: [start, start + 99], items }], ...extra },
  });
}

describe("member ranges", () => {
  test("[0,99] always, then the window slides keeping at most 3 ranges", () => {
    expect(memberRangesUpTo(0)).toEqual([[0, 99]]);
    expect(memberRangesUpTo(1)).toEqual([[0, 99], [100, 199]]);
    expect(memberRangesUpTo(2)).toEqual([[0, 99], [100, 199], [200, 299]]);
    expect(memberRangesUpTo(3)).toEqual([[0, 99], [200, 299], [300, 399]]);
    expect(memberRangesUpTo(10)).toEqual([[0, 99], [900, 999], [1000, 1099]]);
  });

  test("next ranges only when the last subscribed range came back full", () => {
    expect(nextMemberRanges([[0, 99]], 100)).toEqual([[0, 99], [100, 199]]);
    expect(nextMemberRanges([[0, 99]], 57)).toBeNull();
    expect(nextMemberRanges([[0, 99], [100, 199]], 200)).toEqual([[0, 99], [100, 199], [200, 299]]);
    expect(nextMemberRanges([[0, 99], [100, 199], [200, 299]], 300)).toEqual([[0, 99], [200, 299], [300, 399]]);
    expect(nextMemberRanges([[0, 99], [100, 199]], 150)).toBeNull();
  });

  test("op 37 carries the channel's range list and no member ranges", () => {
    const payload = buildGuildSubscription(GUILD, CHANNEL, [[0, 99], [100, 199]]) as { d: any };
    expect(payload.d.subscriptions[GUILD].channels).toEqual({ [CHANNEL]: [[0, 99], [100, 199]] });
    expect(payload.d.subscriptions[GUILD].members).toBeUndefined();
  });
});

describe("member list reducer", () => {
  test("keeps member_count and online_count", () => {
    const store = createStore(emptyState());
    sync(store, 0, 3, { member_count: 14814, online_count: 2345 });
    expect(store.getState().memberCounts[GUILD]).toEqual({ members: 14814, online: 2345 });
    store.dispatch({ type: "gw", t: "GUILD_MEMBER_LIST_UPDATE", d: { guild_id: GUILD, ops: [] } });
    expect(store.getState().memberCounts[GUILD]).toEqual({ members: 14814, online: 2345 });
  });

  test("rows keep their absolute positions across ranges and INVALIDATE", () => {
    const store = createStore(emptyState());
    sync(store, 0, 100);
    sync(store, 200, 100);
    const list = store.getState().memberLists[GUILD]!;
    expect(list).toHaveLength(300);
    expect(list[150]).toBeNull();
    expect(list[200]).toEqual({ kind: "member", userId: "u200" });

    store.dispatch({ type: "gw", t: "GUILD_MEMBER_LIST_UPDATE", d: { guild_id: GUILD, ops: [{ op: "INVALIDATE", range: [0, 99] }] } });
    expect(store.getState().memberLists[GUILD]![200]).toEqual({ kind: "member", userId: "u200" });
    sync(store, 0, 100);
    store.dispatch({
      type: "gw",
      t: "GUILD_MEMBER_LIST_UPDATE",
      d: { guild_id: GUILD, ops: [{ op: "UPDATE", index: 250, item: member(9999) }] },
    });
    expect(store.getState().memberLists[GUILD]![250]).toEqual({ kind: "member", userId: "u9999" });
    // Lo no cargado no aparece en las filas (sin placeholders).
    const rows = selectMemberRows(store.getState(), GUILD);
    expect(rows).toHaveLength(200);
    expect(rows.some((r) => r.kind === "member" && r.userId === "u150")).toBe(false);
  });
});

describe("loadMoreMembers", () => {
  function setup() {
    let now = 10_000;
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const store = createStore(emptyState());
    store.dispatch({
      type: "gw",
      t: "READY",
      d: {
        user: { id: "me", username: "me" },
        guilds: [{ id: GUILD, properties: { name: "g" }, channels: [{ id: CHANNEL, type: 0, name: "a" }, { id: OTHER, type: 0, name: "b" }] }],
      },
    });
    const sent: { op: number; d: any }[] = [];
    const actions = createActions({
      store,
      rest: { closed: false, request: async () => [] as never },
      gateway: { send: (op: number, d: unknown) => void sent.push({ op, d }) },
      now: () => now,
      setTimer: ((fn: () => void, ms: number) => {
        timers.push({ fn, ms });
        return 0;
      }) as never,
    });
    const op37 = () => sent.filter((p) => p.op === 37).map((p) => p.d.subscriptions[GUILD].channels);
    return { store, actions, op37, timers, advance: (ms: number) => (now += ms) };
  }

  test("asks the next range once the loaded rows reach the end; at most one op 37 per 500 ms", async () => {
    const { store, actions, op37, timers, advance } = setup();
    await actions.openChannel(CHANNEL);
    expect(op37()).toEqual([{ [CHANNEL]: [[0, 99]] }]);

    actions.loadMoreMembers!(CHANNEL);
    expect(op37()).toHaveLength(1); // todavía no llegó el SYNC de 0-99

    sync(store, 0, 100);
    actions.loadMoreMembers!(CHANNEL);
    expect(op37()).toHaveLength(2);
    expect(op37()[1]).toEqual({ [CHANNEL]: [[0, 99], [100, 199]] });

    // El SYNC de 100-199 llega enseguida y se sigue scrolleando: un solo envío al final de los 500 ms.
    sync(store, 100, 100);
    advance(100);
    actions.loadMoreMembers!(CHANNEL);
    actions.loadMoreMembers!(CHANNEL);
    actions.loadMoreMembers!(CHANNEL);
    expect(op37()).toHaveLength(2);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(MEMBER_SCROLL_THROTTLE_MS - 100);
    advance(400);
    timers.shift()!.fn();
    expect(op37()).toHaveLength(3);
    expect(op37()[2]).toEqual({ [CHANNEL]: [[0, 99], [100, 199], [200, 299]] });

    sync(store, 200, 100);
    advance(500);
    actions.loadMoreMembers!(CHANNEL);
    expect(op37()[3]).toEqual({ [CHANNEL]: [[0, 99], [200, 299], [300, 399]] });
  });

  test("only for the open channel", async () => {
    const { store, actions, op37 } = setup();
    await actions.openChannel(CHANNEL);
    sync(store, 0, 100);
    store.dispatch({ type: "ui/selectChannel", id: OTHER });
    actions.loadMoreMembers!(CHANNEL);
    expect(op37()).toHaveLength(1);
  });

  test("opening another channel starts again from [0,99] and drops the old list beyond 0-99", async () => {
    const { store, actions, op37 } = setup();
    await actions.openChannel(CHANNEL);
    sync(store, 0, 100);
    actions.loadMoreMembers!(CHANNEL);
    sync(store, 100, 100);
    await actions.openChannel(OTHER);
    expect(op37().at(-1)).toEqual({ [OTHER]: [[0, 99]] });
    expect(store.getState().memberLists[GUILD]).toHaveLength(100);
    expect(store.getState().subscribedRanges[GUILD]).toEqual([[0, 99]]);
  });
});
