import { expect, test } from "bun:test";

import { createStore, emptyState, type Store } from "../../src/store/store";
import { selectUnreadView, snapshotUnread, unreadSince } from "../../src/store/unread";

const GUILD = "700000000000000001";
const CHAN = "700000000000000002";
const OTHER = "700000000000000003";
const ME = "700000000000000010";
const YOU = "700000000000000011";
const id = (n: number): string => `7100000000000${String(10000 + n)}`;

function raw(n: number, author: string, channel = CHAN) {
  return {
    id: id(n),
    channel_id: channel,
    guild_id: GUILD,
    author: { id: author, username: author === ME ? "yo" : "vos" },
    content: `m${n}`,
    timestamp: "2026-11-07T12:00:00.000Z",
    edited_timestamp: null,
    attachments: [],
    embeds: [],
    mentions: [],
    mention_everyone: false,
    referenced_message: null,
    reactions: [],
  };
}

function setup(opts: { lastRead?: string | null; authors?: string[] } = {}): Store {
  const store = createStore(emptyState());
  const channel = (cid: string, position: number) => ({
    id: cid,
    name: cid === CHAN ? "general" : "otro",
    type: 0,
    position,
    parent_id: null,
    permission_overwrites: [],
    last_message_id: null,
  });
  store.dispatch({
    type: "gw",
    t: "READY",
    d: {
      user: { id: ME, username: "yo" },
      users: [],
      guilds: [{ id: GUILD, properties: { name: "g", owner_id: ME }, roles: [], channels: [channel(CHAN, 0), channel(OTHER, 1)] }],
      private_channels: [],
      read_state: opts.lastRead === null ? [] : [{ id: CHAN, last_message_id: opts.lastRead ?? id(3), mention_count: 0 }],
      user_guild_settings: [],
    },
  });
  const authors = opts.authors ?? [YOU, YOU, YOU, YOU, YOU, YOU];
  const messages = authors.map((author, i) => raw(i + 1, author)).reverse();
  store.dispatch({ type: "messages/page", channelId: CHAN, messages: messages as never, mode: "latest" });
  return store;
}

test("opening a channel snapshots where reading was", () => {
  const store = setup();
  store.dispatch({ type: "ui/selectChannel", id: CHAN });
  expect(store.getState().ui.unreadMarker).toEqual({ channelId: CHAN, afterId: id(3) });
  expect(selectUnreadView(store.getState(), CHAN)).toMatchObject({ firstUnreadId: id(4), count: 3, missing: false });
});

test("the ack after opening does not move the divider", () => {
  const store = setup();
  store.dispatch({ type: "ui/selectChannel", id: CHAN });
  store.dispatch({ type: "gw", t: "MESSAGE_ACK", d: { channel_id: CHAN, message_id: id(6) } });
  store.dispatch({ type: "ui/selectChannel", id: CHAN });
  expect(store.getState().readState[CHAN]?.lastAckedId).toBe(id(6));
  expect(selectUnreadView(store.getState(), CHAN).firstUnreadId).toBe(id(4));
});

test("reopening the channel recalculates: after the ack there is no divider", () => {
  const store = setup();
  store.dispatch({ type: "ui/selectChannel", id: CHAN });
  store.dispatch({ type: "gw", t: "MESSAGE_ACK", d: { channel_id: CHAN, message_id: id(6) } });
  store.dispatch({ type: "ui/selectChannel", id: OTHER });
  expect(store.getState().ui.unreadMarker).toBeNull();
  store.dispatch({ type: "ui/selectChannel", id: CHAN });
  expect(store.getState().ui.unreadMarker).toBeNull();
  expect(selectUnreadView(store.getState(), CHAN).firstUnreadId).toBeNull();

  // Llega uno nuevo de otro estando en otro canal: al volver, el divisor va antes de ése.
  store.dispatch({ type: "ui/selectChannel", id: OTHER });
  store.dispatch({ type: "gw", t: "MESSAGE_CREATE", d: raw(7, YOU) });
  store.dispatch({ type: "ui/selectChannel", id: CHAN });
  expect(selectUnreadView(store.getState(), CHAN)).toMatchObject({ firstUnreadId: id(7), count: 1 });
});

test("own messages never start the divider", () => {
  const store = setup({ authors: [YOU, YOU, YOU, ME, ME, YOU] });
  store.dispatch({ type: "ui/selectChannel", id: CHAN });
  expect(selectUnreadView(store.getState(), CHAN)).toMatchObject({ firstUnreadId: id(6), count: 1 });

  const onlyMine = setup({ authors: [YOU, YOU, YOU, ME, ME] });
  onlyMine.dispatch({ type: "ui/selectChannel", id: CHAN });
  expect(selectUnreadView(onlyMine.getState(), CHAN).firstUnreadId).toBeNull();

  // Mandar un mensaje estando en el canal tampoco crea divisor.
  const read = setup({ lastRead: id(6) });
  read.dispatch({ type: "ui/selectChannel", id: CHAN });
  read.dispatch({ type: "gw", t: "MESSAGE_CREATE", d: raw(7, ME) });
  expect(selectUnreadView(read.getState(), CHAN).firstUnreadId).toBeNull();
});

test("everything read, or no read state: no divider", () => {
  const read = setup({ lastRead: id(6) });
  read.dispatch({ type: "ui/selectChannel", id: CHAN });
  expect(read.getState().ui.unreadMarker).toBeNull();

  const unknown = setup({ lastRead: null });
  expect(snapshotUnread(unknown.getState(), CHAN)).toBeNull();
});

test("first unread older than the oldest loaded: missing, no divider yet", () => {
  const store = setup({ lastRead: "710000000000000001" });
  store.dispatch({ type: "ui/selectChannel", id: CHAN });
  expect(selectUnreadView(store.getState(), CHAN)).toMatchObject({ firstUnreadId: null, count: 6, missing: true });
});

test("the bar's time comes from the last read snowflake; an id without a date says nothing", () => {
  const when = new Date(2026, 10, 7, 9, 5);
  const id = ((BigInt(when.getTime()) - 1420070400000n) << 22n).toString();
  expect(unreadSince(id, new Date(2026, 10, 7, 20, 0))).toBe(" desde las 09:05");
  expect(unreadSince(id, new Date(2026, 10, 9, 20, 0))).toBe(" desde el 07/11 09:05");
  expect(unreadSince("0")).toBe("");
});
