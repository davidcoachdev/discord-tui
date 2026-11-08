import { expect, test } from "bun:test";

import { selectChannelList, selectDmMemberRows } from "../../src/store/selectors";
import { createStore, emptyState } from "../../src/store/store";

const ME = "100000000000000010";
const A = "100000000000000011";
const B = "100000000000000012";
const C = "100000000000000013";

/** READY como lo manda Discord a una cuenta de usuario: DMs con `recipient_ids` y los usuarios aparte. */
function readyStore() {
  const store = createStore(emptyState());
  store.dispatch({
    type: "gw",
    t: "READY",
    d: {
      user: { id: ME, username: "gon" },
      users: [
        { id: A, username: "ana", global_name: "Ana" },
        { id: B, username: "beto", global_name: null },
        { id: C, username: "caro", global_name: "Caro" },
      ],
      guilds: [],
      private_channels: [
        { id: "200000000000000001", type: 1, recipient_ids: [A], last_message_id: "300000000000000010" },
        { id: "200000000000000002", type: 1, recipient_ids: [B], last_message_id: "300000000000000050" },
        { id: "200000000000000003", type: 3, recipient_ids: [A, C], name: null, last_message_id: "300000000000000030" },
        { id: "200000000000000004", type: 3, recipient_ids: [A, B, C], name: "Los pibes", last_message_id: null },
      ],
    },
  });
  return store;
}

const names = (store: ReturnType<typeof createStore>) => selectChannelList(store.getState(), "@dms").map((row) => row.name);

test("DM names come from recipient_ids (global name first), groups use their own name or the members", () => {
  expect(names(readyStore()).sort()).toEqual(["Ana", "Ana, Caro", "Los pibes", "beto"].sort());
});

test("DMs are ordered by latest activity and a new message moves the DM to the top", () => {
  const store = readyStore();
  expect(names(store)).toEqual(["beto", "Ana, Caro", "Ana", "Los pibes"]);
  store.dispatch({ type: "gw", t: "MESSAGE_CREATE", d: { id: "300000000000000099", channel_id: "200000000000000001", author: { id: A, username: "ana" }, content: "hola" } });
  expect(names(store)[0]).toBe("Ana");
});

test("a first message from someone new creates the DM; CHANNEL_CREATE adds a new DM at the top", () => {
  const store = readyStore();
  store.dispatch({
    type: "gw",
    t: "MESSAGE_CREATE",
    d: { id: "300000000000000100", channel_id: "200000000000000009", author: { id: "100000000000000099", username: "nuevo", global_name: "Nuevo" }, content: "che" },
  });
  expect(names(store)[0]).toBe("Nuevo");
  store.dispatch({
    type: "gw",
    t: "CHANNEL_CREATE",
    d: { id: "200000000000000010", type: 1, recipients: [{ id: "100000000000000098", username: "otra", global_name: "Otra" }], last_message_id: "300000000000000200" },
  });
  expect(names(store)[0]).toBe("Otra");
});

test("people joining or leaving a group update its name; CHANNEL_DELETE removes it", () => {
  const store = readyStore();
  store.dispatch({ type: "gw", t: "CHANNEL_RECIPIENT_REMOVE", d: { channel_id: "200000000000000003", user: { id: C, username: "caro" } } });
  expect(names(store)).toContain("Ana");
  store.dispatch({ type: "gw", t: "CHANNEL_RECIPIENT_ADD", d: { channel_id: "200000000000000003", user: { id: B, username: "beto" } } });
  expect(names(store)).toContain("Ana, beto");
  store.dispatch({ type: "ui/selectChannel", id: "200000000000000003" });
  store.dispatch({ type: "gw", t: "CHANNEL_DELETE", d: { id: "200000000000000003", type: 3 } });
  expect(names(store)).not.toContain("Ana, beto");
  expect(store.getState().ui.selectedChannelId).toBeNull();
});

test("READY_SUPPLEMENTAL lazy DMs keep the global name and friends' presence fills the DM dot", () => {
  const store = readyStore();
  store.dispatch({
    type: "gw",
    t: "READY_SUPPLEMENTAL",
    d: {
      lazy_private_channels: [{ id: "200000000000000020", type: 1, recipient_ids: [C], last_message_id: "300000000000000900" }],
      merged_presences: { friends: [{ user_id: C, status: "dnd" }], guilds: [] },
    },
  });
  const row = selectChannelList(store.getState(), "@dms")[0]!;
  expect(row).toMatchObject({ name: "Caro", status: "dnd", kind: "dm" });
  expect(store.getState().users[C]?.globalName).toBe("Caro");
});

test("guild CHANNEL_UPDATE renames, GUILD_MEMBER_UPDATE changes the nick", () => {
  const store = createStore(emptyState());
  store.dispatch({ type: "gw", t: "READY", d: { user: { id: ME, username: "gon" }, guilds: [{ id: "1", properties: { name: "g" }, roles: [], channels: [{ id: "5", type: 0, name: "general" }] }] } });
  store.dispatch({ type: "gw", t: "CHANNEL_UPDATE", d: { id: "5", guild_id: "1", type: 0, name: "charla" } });
  expect(store.getState().channels["5"]?.name).toBe("charla");
  store.dispatch({ type: "gw", t: "GUILD_MEMBER_UPDATE", d: { guild_id: "1", user: { id: A, username: "ana" }, nick: "Anita", roles: [] } });
  expect(store.getState().members["1"]?.[A]?.nick).toBe("Anita");
});

test("the member panel of a group shows its people and me", () => {
  const store = readyStore();
  const rows = selectDmMemberRows(store.getState(), "200000000000000004");
  expect(rows.filter((r) => r.kind === "member").map((r) => (r as { userId: string }).userId)).toEqual([A, B, C, ME]);
});
