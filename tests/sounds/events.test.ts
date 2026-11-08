import { describe, expect, test } from "bun:test";

import { attachVoiceSounds, ownVoiceCues, peerCue } from "../../src/sounds/events";
import type { Cue } from "../../src/sounds/synth";
import { createStore, emptyState } from "../../src/store/store";
import type { AppState } from "../../src/store/types";

const ME = "100000000000000010";
const OTHER = "100000000000000020";
const GUILD = "100000000000000001";
const MINE = "100000000000000003";
const ELSEWHERE = "100000000000000004";

function vsu(userId: string, channelId: string | null) {
  return { type: "gw" as const, t: "VOICE_STATE_UPDATE", d: { guild_id: GUILD, user_id: userId, channel_id: channelId } };
}

function connectedStore() {
  const store = createStore({ ...emptyState(), me: { id: ME, username: "me" } });
  store.dispatch({ type: "voice/joining", guildId: GUILD, channelId: MINE });
  store.dispatch({ type: "voice/status", status: "connected" });
  return store;
}

/** Despacha y devuelve el cue de gente que entra/sale, como hace el runtime. */
function step(store: ReturnType<typeof createStore>, action: any): Cue | null {
  const before: AppState = store.getState();
  store.dispatch(action);
  return peerCue(before, store.getState());
}

describe("peerCue", () => {
  test("someone joining / leaving my channel → userJoin / userLeave", () => {
    const store = connectedStore();
    expect(step(store, vsu(OTHER, MINE))).toBe("userJoin");
    expect(step(store, vsu(OTHER, MINE))).toBeNull(); // un cambio de mute no es entrar
    expect(step(store, vsu(OTHER, ELSEWHERE))).toBe("userLeave"); // se fue a otro canal
    expect(step(store, vsu(OTHER, MINE))).toBe("userJoin");
    expect(step(store, vsu(OTHER, null))).toBe("userLeave");
  });

  test("other channels and myself never sound", () => {
    const store = connectedStore();
    expect(step(store, vsu(OTHER, ELSEWHERE))).toBeNull();
    expect(step(store, vsu(ME, MINE))).toBeNull();
    expect(step(store, vsu(ME, null))).toBeNull();
  });

  test("not connected (or still joining) → nothing", () => {
    const store = createStore({ ...emptyState(), me: { id: ME, username: "me" } });
    expect(step(store, vsu(OTHER, MINE))).toBeNull();
    store.dispatch({ type: "voice/joining", guildId: GUILD, channelId: MINE });
    expect(step(store, vsu(OTHER, MINE))).toBeNull();
  });

  test("people already in the channel when I join → nothing", () => {
    const store = createStore({ ...emptyState(), me: { id: ME, username: "me" } });
    store.dispatch(vsu(OTHER, MINE));
    store.dispatch({ type: "voice/joining", guildId: GUILD, channelId: MINE });
    expect(step(store, { type: "voice/status", status: "connected" })).toBeNull();
  });

  test("being moved to a channel with people → nothing", () => {
    const store = connectedStore();
    store.dispatch(vsu(OTHER, ELSEWHERE));
    expect(step(store, { type: "voice/moved", channelId: ELSEWHERE })).toBeNull();
  });
});

describe("own voice cues", () => {
  function recorded() {
    const store = createStore({ ...emptyState(), me: { id: ME, username: "me" } });
    const cues: Cue[] = [];
    attachVoiceSounds(store, (cue) => cues.push(cue));
    return { store, cues };
  }

  test("join when connected, leave on leaving, disconnect on error", () => {
    const { store, cues } = recorded();
    store.dispatch({ type: "voice/joining", guildId: GUILD, channelId: MINE });
    expect(cues).toEqual([]);
    store.dispatch({ type: "voice/status", status: "connected" });
    expect(cues).toEqual(["join"]);
    store.dispatch({ type: "voice/left" });
    expect(cues).toEqual(["join", "leave"]);
    store.dispatch({ type: "voice/joining", guildId: GUILD, channelId: MINE });
    store.dispatch({ type: "voice/status", status: "connected" });
    store.dispatch({ type: "voice/left", error: "se cortó la voz" });
    expect(cues).toEqual(["join", "leave", "join", "disconnect"]);
  });

  test("reconnecting → connected does not replay join", () => {
    const { store, cues } = recorded();
    store.dispatch({ type: "voice/joining", guildId: GUILD, channelId: MINE });
    store.dispatch({ type: "voice/status", status: "connected" });
    store.dispatch({ type: "voice/status", status: "reconnecting" });
    store.dispatch({ type: "voice/status", status: "connected" });
    expect(cues).toEqual(["join"]);
  });

  test("mute/deafen: deafening (which also mutes) plays only deafen", () => {
    const { store, cues } = recorded();
    store.dispatch({ type: "voice/flags", selfMute: true, selfDeaf: false, muteBeforeDeaf: false });
    store.dispatch({ type: "voice/flags", selfMute: false, selfDeaf: false, muteBeforeDeaf: false });
    store.dispatch({ type: "voice/flags", selfMute: true, selfDeaf: true, muteBeforeDeaf: false });
    store.dispatch({ type: "voice/flags", selfMute: false, selfDeaf: false, muteBeforeDeaf: false });
    expect(cues).toEqual(["mute", "unmute", "deafen", "undeafen"]);
  });

  test("stream start/stop; leaving voice while live plays only leave", () => {
    const { store, cues } = recorded();
    store.dispatch({ type: "voice/joining", guildId: GUILD, channelId: MINE });
    store.dispatch({ type: "voice/status", status: "connected" });
    store.dispatch({ type: "voice/stream", patch: { status: "starting" } });
    store.dispatch({ type: "voice/stream", patch: { status: "live" } });
    store.dispatch({ type: "voice/stream", patch: { status: "idle" } });
    store.dispatch({ type: "voice/stream", patch: { status: "live" } });
    store.dispatch({ type: "voice/left" });
    expect(cues).toEqual(["join", "streamStart", "streamStop", "streamStart", "leave"]);
  });

  test("ownVoiceCues is pure: same slice → nothing", () => {
    const v = emptyState().voice;
    expect(ownVoiceCues(v, v)).toEqual([]);
  });
});
