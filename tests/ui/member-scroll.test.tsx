import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import { createActions, type Actions } from "../../src/actions";
import { App } from "../../src/ui/App";
import { buildDemoStore, demoActions, DEMO } from "../../scripts/demo-state";

function setup() {
  const store = buildDemoStore();
  const items = Array.from({ length: 100 }, (_, i) =>
    i === 0
      ? { group: { id: "online", count: 14000 } }
      : { member: { user: { id: `97${String(i).padStart(16, "0")}`, username: `persona${i}` }, roles: [], presence: { status: "online" } } },
  );
  store.dispatch({
    type: "gw",
    t: "GUILD_MEMBER_LIST_UPDATE",
    d: { guild_id: DEMO.guild, id: "everyone", member_count: 14814, online_count: 14000, ops: [{ op: "SYNC", range: [0, 99], items }] },
  });
  store.dispatch({ type: "members/subscribed", guildId: DEMO.guild, channelId: DEMO.general });
  const sent: { op: number; d: any }[] = [];
  const real = createActions({
    store,
    rest: { closed: false, request: async () => [] as never },
    gateway: { send: (op: number, d: unknown) => void sent.push({ op, d }) },
  });
  const actions: Actions = { ...demoActions(store), loadMoreMembers: real.loadMoreMembers };
  return { store, actions, sent };
}

test("wheel down to the end of the member list asks the next range with one op 37", async () => {
  const s = setup();
  const h = await testRender(() => <App store={s.store} actions={s.actions} onQuit={() => {}} />, { width: 160, height: 45 });
  await h.renderOnce();
  const frame = h.captureCharFrame();
  expect(frame).toContain("Miembros · 14.814");
  expect(frame).toContain("persona1");
  const line = frame.split("\n").findIndex((l) => l.includes("persona3"));
  const x = Bun.stringWidth(frame.split("\n")[line]!.slice(0, frame.split("\n")[line]!.indexOf("persona3"))) + 2;

  // Unas vueltas de rueda que no llegan al final no piden nada.
  for (let i = 0; i < 3; i += 1) await h.mockMouse.scroll(x, line, "down");
  await h.renderOnce();
  expect(s.sent.filter((p) => p.op === 37)).toHaveLength(0);

  for (let i = 0; i < 80; i += 1) await h.mockMouse.scroll(x, line, "down");
  await h.renderOnce();
  await Bun.sleep(600);
  const op37 = s.sent.filter((p) => p.op === 37);
  expect(op37).toHaveLength(1);
  expect(op37[0]!.d.subscriptions[DEMO.guild].channels).toEqual({ [DEMO.general]: [[0, 99], [100, 199]] });
  expect(op37[0]!.d.subscriptions[DEMO.guild].members).toBeUndefined();
  expect(h.captureCharFrame()).toContain("persona99");
});
