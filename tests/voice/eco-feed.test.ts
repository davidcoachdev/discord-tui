import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { attachVoiceFeed, fileFeedWriter, type FeedEvent } from "../../src/voice/eco-feed";
import { voiceFeedPath } from "../../src/config/paths";
import { createStore, emptyState } from "../../src/store/store";

const ME = "100000000000000010";
const ANA = "100000000000000020";
const BETO = "100000000000000030";
const GUILD = "100000000000000001";
const MINE = "100000000000000003";
const OTHER = "100000000000000004";

function vsu(userId: string, channelId: string | null, nick?: string) {
  return {
    type: "gw" as const,
    t: "VOICE_STATE_UPDATE",
    d: {
      guild_id: GUILD,
      user_id: userId,
      channel_id: channelId,
      member: nick === undefined ? undefined : { user: { id: userId, username: `${nick}_u`, global_name: null }, nick, roles: [] },
    },
  };
}

function setup() {
  const base = emptyState();
  const store = createStore({
    ...base,
    me: { id: ME, username: "gon" },
    users: { [ME]: { id: ME, username: "gon", globalName: "Gon", avatar: null, bot: false } },
    guilds: { [GUILD]: { id: GUILD, name: "Los Pibes", icon: null, ownerId: ME, roles: [], emojis: [] } as never },
    channels: {
      [MINE]: { id: MINE, guildId: GUILD, name: "General", type: 2, position: 0, parentId: null } as never,
      [OTHER]: { id: OTHER, guildId: GUILD, name: "AFK", type: 2, position: 1, parentId: null } as never,
    },
  });
  const writes: { lines: FeedEvent[]; truncate: boolean }[] = [];
  let t = 1_700_000_000;
  const detach = attachVoiceFeed(store, {
    pid: 4242,
    now: () => (t += 1),
    write: (lines, truncate) =>
      writes.push({ truncate, lines: lines.trimEnd().split("\n").map((l) => JSON.parse(l) as FeedEvent) }),
  });
  return { store, writes, detach, all: () => writes.flatMap((w) => w.lines) };
}

function enter(store: ReturnType<typeof setup>["store"], channelId = MINE) {
  store.dispatch({ type: "voice/joining", guildId: GUILD, channelId });
  store.dispatch(vsu(ME, channelId));
  store.dispatch({ type: "voice/status", status: "connected" });
}

describe("voice feed for eco", () => {
  test("nothing is written outside a call", () => {
    const { store, writes } = setup();
    store.dispatch(vsu(ANA, MINE, "Anita"));
    store.dispatch({ type: "voice/speaking", userId: ANA, on: true });
    store.dispatch({ type: "voice/joining", guildId: GUILD, channelId: MINE });
    expect(writes).toEqual([]);
  });

  test("connecting truncates and writes JOIN with channel, server, me and who is there", () => {
    const { store, writes } = setup();
    store.dispatch(vsu(ANA, MINE, "Anita"));
    store.dispatch(vsu(BETO, OTHER, "Beto"));
    enter(store);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.truncate).toBe(true);
    const [ev] = writes[0]!.lines;
    expect(ev).toMatchObject({
      evt: "JOIN",
      user: "Gon",
      user_id: ME,
      self_id: ME,
      pid: 4242,
      channel: "General",
      channel_id: MINE,
      guild: "Los Pibes",
      guild_id: GUILD,
    });
    expect(ev!.t).toBeGreaterThan(1_700_000_000);
    expect(ev!.members).toEqual([
      { user_id: ANA, user: "Anita" },
      { user_id: ME, user: "Gon" },
    ]);
  });

  test("others speaking (with their nick) and me speaking (selfSpeaking) are START/STOP pairs", () => {
    const { store, all } = setup();
    store.dispatch(vsu(ANA, MINE, "Anita"));
    enter(store);
    store.dispatch({ type: "voice/speaking", userId: ANA, on: true });
    store.dispatch({ type: "voice/selfSpeaking", on: true });
    store.dispatch({ type: "voice/speaking", userId: ANA, on: false });
    store.dispatch({ type: "voice/selfSpeaking", on: false });
    const speech = all().filter((e) => e.evt.startsWith("SPEAKING"));
    expect(speech.map((e) => [e.evt, e.user, e.user_id])).toEqual([
      ["SPEAKING_START", "Anita", ANA],
      ["SPEAKING_START", "Gon", ME],
      ["SPEAKING_STOP", "Anita", ANA],
      ["SPEAKING_STOP", "Gon", ME],
    ]);
    const ts = speech.map((e) => e.t);
    expect([...ts].sort()).toEqual(ts);
    expect(speech.every((e) => e.channel === "General" && e.guild === "Los Pibes")).toBe(true);
  });

  test("people entering and leaving my channel are JOIN/LEAVE; leaving mid-speech closes the span", () => {
    const { store, all } = setup();
    enter(store);
    store.dispatch(vsu(BETO, MINE, "Beto"));
    store.dispatch({ type: "voice/speaking", userId: BETO, on: true });
    store.dispatch(vsu(BETO, null));
    expect(all().slice(1).map((e) => [e.evt, e.user_id])).toEqual([
      ["JOIN", BETO],
      ["SPEAKING_START", BETO],
      ["SPEAKING_STOP", BETO],
      ["LEAVE", BETO],
    ]);
  });

  test("hanging up stops whoever was speaking and writes my LEAVE (no truncation)", () => {
    const { store, writes } = setup();
    store.dispatch(vsu(ANA, MINE, "Anita"));
    enter(store);
    store.dispatch({ type: "voice/speaking", userId: ANA, on: true });
    store.dispatch({ type: "voice/left" });
    const last = writes.at(-1)!;
    expect(last.truncate).toBe(false);
    expect(last.lines.map((e) => [e.evt, e.user_id])).toEqual([
      ["SPEAKING_STOP", ANA],
      ["LEAVE", ME],
    ]);
  });

  test("being moved to another channel starts a fresh file with the new channel", () => {
    const { store, writes } = setup();
    enter(store);
    store.dispatch(vsu(ME, OTHER));
    store.dispatch({ type: "voice/moved", channelId: OTHER });
    const last = writes.at(-1)!;
    expect(last.truncate).toBe(true);
    expect(last.lines[0]).toMatchObject({ evt: "JOIN", self_id: ME, channel: "AFK", channel_id: OTHER });
  });

  test("a reconnect does not count as leaving", () => {
    const { store, writes } = setup();
    enter(store);
    store.dispatch({ type: "voice/status", status: "reconnecting" });
    store.dispatch({ type: "voice/status", status: "connected" });
    expect(writes).toHaveLength(1);
  });

  test("the file writer truncates on JOIN and appends after (and tests never touch the real runtime dir)", () => {
    expect(voiceFeedPath()).toStartWith(process.env.DISCORD_TUI_RUNTIME_DIR!);
    const path = join(mkdtempSync(join(tmpdir(), "feed-")), "sub", "voz.jsonl");
    const write = fileFeedWriter(path);
    write('{"a":1}\n', false);
    write('{"b":2}\n', true);
    write('{"c":3}\n', false);
    expect(readFileSync(path, "utf8")).toBe('{"b":2}\n{"c":3}\n');
  });
});
