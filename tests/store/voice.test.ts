import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { selectVoiceParticipants } from "../../src/store/selectors";
import { createStore, emptyState } from "../../src/store/store";

const fixture = (name: string) => JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "fixtures", "gateway", name), "utf8"));
const GUILD = "100000000000000001";
const VOICE = "100000000000000003";
const ME = "100000000000000010";

test("READY voice_states and VOICE_STATE_UPDATE fill who is in each channel", () => {
  const store = createStore(emptyState());
  store.dispatch({
    type: "gw",
    t: "READY",
    d: { user: { id: ME, username: "me" }, guilds: [{ id: GUILD, voice_states: [{ user_id: "7", channel_id: VOICE, self_mute: true }] }] },
  });
  expect(selectVoiceParticipants(store.getState(), GUILD, VOICE).map((p) => [p.userId, p.muted])).toEqual([["7", true]]);

  store.dispatch({ type: "gw", t: "VOICE_STATE_UPDATE", d: fixture("VOICE_STATE_UPDATE-1.json").d });
  expect(selectVoiceParticipants(store.getState(), GUILD, VOICE).map((p) => p.userId).sort()).toEqual(["100000000000000010", "7"].sort());

  store.dispatch({ type: "gw", t: "VOICE_STATE_UPDATE", d: { guild_id: GUILD, user_id: "7", channel_id: null } });
  expect(selectVoiceParticipants(store.getState(), GUILD, VOICE).map((p) => p.userId)).toEqual([ME]);
});

test("speaking marks participants and self speaking only counts in the joined channel", () => {
  const store = createStore(emptyState());
  store.dispatch({ type: "gw", t: "READY", d: { user: { id: ME, username: "me" }, guilds: [{ id: GUILD, voice_states: [] }] } });
  store.dispatch({ type: "gw", t: "VOICE_STATE_UPDATE", d: { guild_id: GUILD, user_id: ME, channel_id: VOICE } });
  store.dispatch({ type: "gw", t: "VOICE_STATE_UPDATE", d: { guild_id: GUILD, user_id: "7", channel_id: VOICE } });
  store.dispatch({ type: "voice/joining", guildId: GUILD, channelId: VOICE });
  store.dispatch({ type: "voice/speaking", userId: "7", on: true });
  store.dispatch({ type: "voice/selfSpeaking", on: true });
  const parts = selectVoiceParticipants(store.getState(), GUILD, VOICE);
  expect(parts.every((p) => p.speaking)).toBe(true);
  store.dispatch({ type: "voice/left" });
  expect(store.getState().voice.speaking).toEqual({});
  expect(store.getState().voice.selfSpeaking).toBe(false);
});

test("READY_SUPPLEMENTAL voice_states fill the channels (user READY guilds are lazy, without voice_states)", () => {
  const store = createStore(emptyState());
  store.dispatch({ type: "gw", t: "READY", d: { user: { id: ME, username: "me" }, guilds: [{ id: GUILD, lazy: true, channels: [] }] } });
  store.dispatch({
    type: "gw",
    t: "READY_SUPPLEMENTAL",
    d: {
      guilds: [
        {
          id: GUILD,
          voice_states: [
            { user_id: "7", channel_id: VOICE, self_mute: false, member: { user: { id: "7", username: "quique", global_name: "Quique" }, roles: [], nick: null } },
            { user_id: "8", channel_id: VOICE, self_deaf: true },
          ],
        },
      ],
      merged_members: [[{ user_id: "8", nick: "Ocho", roles: [] }]],
    },
  });
  const parts = selectVoiceParticipants(store.getState(), GUILD, VOICE);
  expect(parts.map((p) => [p.userId, p.deafened])).toEqual([["7", false], ["8", true]]);
  expect(store.getState().users["7"]?.globalName).toBe("Quique");
  expect(store.getState().members[GUILD]?.["8"]?.nick).toBe("Ocho");
});
