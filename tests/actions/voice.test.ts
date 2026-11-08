import { describe, expect, test } from "bun:test";

import { createVoiceActions, type VoiceMedia } from "../../src/actions/voice";
import { createStore, emptyState } from "../../src/store/store";
import type { VoiceSession, VoiceStatus } from "../../src/voice/session";

const GUILD = "100000000000000001";
const VOICE_A = "100000000000000003";
const VOICE_B = "100000000000000004";
const TEXT = "100000000000000002";
const ME = "100000000000000010";

function setup(opts: { micFails?: boolean } = {}) {
  const store = createStore(emptyState());
  store.dispatch({
    type: "gw",
    t: "READY",
    d: {
      user: { id: ME, username: "gon" },
      guilds: [
        {
          id: GUILD,
          name: "g",
          roles: [],
          channels: [
            { id: TEXT, type: 0, name: "general" },
            { id: VOICE_A, type: 2, name: "Voz" },
            { id: VOICE_B, type: 2, name: "Voz 2" },
          ],
        },
      ],
    },
  });
  const calls: string[] = [];
  const statusListeners = new Set<(s: VoiceStatus, e?: string) => void>();
  const emit = (s: VoiceStatus, e?: string) => statusListeners.forEach((fn) => fn(s, e));
  const session: VoiceSession = {
    async join(_g, channelId, flags) {
      calls.push(`join:${channelId}:${flags.selfMute}:${flags.selfDeaf}`);
      emit("joining");
      emit("connected");
    },
    setFlags(flags) {
      calls.push(`flags:${flags.selfMute}:${flags.selfDeaf}`);
    },
    async leave() {
      calls.push("leave");
      emit("idle");
    },
    onStatus(fn) {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    },
    sendOpus() {},
    setSpeaking() {},
    onSpeaking: () => () => {},
    onOpus: () => () => {},
    privacyCode: () => "123451234512345",
  };
  const stopped: string[] = [];
  const media: VoiceMedia = {
    async startCapture() {
      if (opts.micFails) throw new Error("no pude abrir el micrófono (pw-record: x)");
      return { onFrame: () => () => {}, stop: async () => void stopped.push("capture") };
    },
    async startPlayback() {
      return { write() {}, stop: async () => void stopped.push("playback"), dropped: () => 0 };
    },
    createCodec: () => ({ encode: (p) => p, decode: (o) => o }),
    createVad: () => ({ push: () => null, isOpen: false, thresholdDb: -45, levelDb: -96 }),
  };
  const voice = createVoiceActions({ store, session, media });
  return { store, voice, calls, emit, stopped };
}

test("toggleVoice joins, and again leaves", async () => {
  const { store, voice, calls } = setup();
  await voice.toggleVoice(VOICE_A);
  expect(store.getState().voice).toMatchObject({ channelId: VOICE_A, guildId: GUILD, status: "connected" });
  await voice.toggleVoice(VOICE_A);
  expect(calls).toEqual([`join:${VOICE_A}:false:false`, "leave"]);
  expect(store.getState().voice.channelId).toBeNull();
});

test("toggleVoice on another channel of the same guild leaves first, then joins", async () => {
  const { voice, calls, store } = setup();
  await voice.toggleVoice(VOICE_A);
  await voice.toggleVoice(VOICE_B);
  expect(calls).toEqual([`join:${VOICE_A}:false:false`, "leave", `join:${VOICE_B}:false:false`]);
  expect(store.getState().voice.channelId).toBe(VOICE_B);
});

test("a text channel is not joined and shows a notice", async () => {
  const { voice, calls, store } = setup();
  await voice.toggleVoice(TEXT);
  expect(calls).toEqual([]);
  expect(Object.values(store.getState().notices)[0]?.text).toContain("canal de voz");
});

test("deafen also mutes; undeafen restores the previous mute; changes go out as setFlags", async () => {
  const { voice, store, calls } = setup();
  await voice.toggleVoice(VOICE_A);
  voice.toggleDeaf();
  expect(store.getState().voice).toMatchObject({ selfMute: true, selfDeaf: true });
  voice.toggleDeaf();
  expect(store.getState().voice).toMatchObject({ selfMute: false, selfDeaf: false });
  voice.toggleMute();
  voice.toggleDeaf();
  voice.toggleDeaf();
  expect(store.getState().voice).toMatchObject({ selfMute: true, selfDeaf: false });
  expect(calls.slice(1)).toEqual(["flags:true:true", "flags:false:false", "flags:true:false", "flags:true:true", "flags:true:false"]);
});

test("mute state carries into the next join", async () => {
  const { voice, calls } = setup();
  voice.toggleMute();
  await voice.toggleVoice(VOICE_A);
  expect(calls).toEqual([`join:${VOICE_A}:true:false`]);
});

test("a session error leaves voice with the message and stops the audio", async () => {
  const { voice, store, emit, stopped } = setup();
  await voice.toggleVoice(VOICE_A);
  await Bun.sleep(5);
  emit("error", "Discord exige cifrado E2EE (DAVE) y no se pudo negociar");
  await Bun.sleep(5);
  expect(store.getState().voice).toMatchObject({ channelId: null, status: "error", error: "Discord exige cifrado E2EE (DAVE) y no se pudo negociar" });
  expect(stopped.sort()).toEqual(["capture", "playback"]);
});

test("without a mic it stays connected (listen only) and says why", async () => {
  const { voice, store } = setup({ micFails: true });
  await voice.toggleVoice(VOICE_A);
  await Bun.sleep(5);
  expect(store.getState().voice.status).toBe("connected");
  expect(store.getState().voice.micError).toContain("micrófono");
});

test("being removed from the channel by Discord leaves voice here too", async () => {
  const { voice, store, calls } = setup();
  await voice.toggleVoice(VOICE_A);
  store.dispatch({ type: "gw", t: "VOICE_STATE_UPDATE", d: { guild_id: GUILD, user_id: ME, channel_id: VOICE_A } });
  store.dispatch({ type: "gw", t: "VOICE_STATE_UPDATE", d: { guild_id: GUILD, user_id: ME, channel_id: null } });
  await Bun.sleep(5);
  expect(calls.at(-1)).toBe("leave");
  expect(store.getState().voice).toMatchObject({ channelId: null, error: "te desconectaron del canal" });
});

test("M toggles the input mode and pttKey only acts in push_to_talk", async () => {
  const { voice, store } = setup();
  voice.pttKey({ name: "space", eventType: "press" });
  expect(store.getState().settings.inputMode).toBe("voice_activity");
  voice.toggleInputMode();
  expect(store.getState().settings.inputMode).toBe("push_to_talk");
  voice.toggleInputMode();
  expect(store.getState().settings.inputMode).toBe("voice_activity");
});

test("privacy code is polled into the store while connected", async () => {
  const { voice, store } = setup();
  await voice.toggleVoice(VOICE_A);
  await Bun.sleep(1_100);
  expect(store.getState().voice.privacyCode).toBe("123451234512345");
  await voice.leaveVoice();
});

describe("output refresh for clock drift in long calls", () => {
  function refreshSetup(refresh: { checkMs: number; minUptimeMs: number; quietMs: number }) {
    const store = createStore(emptyState());
    store.dispatch({
      type: "gw",
      t: "READY",
      d: { user: { id: ME, username: "gon" }, guilds: [{ id: GUILD, name: "g", roles: [], channels: [{ id: VOICE_A, type: 2, name: "Voz" }] }] },
    });
    const statusListeners = new Set<(s: VoiceStatus, e?: string) => void>();
    const session: VoiceSession = {
      async join() {
        statusListeners.forEach((fn) => fn("connected"));
      },
      setFlags() {},
      async leave() {
        statusListeners.forEach((fn) => fn("idle"));
      },
      onStatus(fn) {
        statusListeners.add(fn);
        return () => statusListeners.delete(fn);
      },
      sendOpus() {},
      setSpeaking() {},
      onSpeaking: () => () => {},
      onOpus: () => () => {},
      privacyCode: () => null,
    };
    let opened = 0;
    let stopped = 0;
    const voice = createVoiceActions({
      store,
      session,
      refresh,
      media: {
        startCapture: async () => ({ onFrame: () => () => {}, stop: async () => {} }),
        startPlayback: async () => {
          opened += 1;
          return { write() {}, stop: async () => void (stopped += 1), dropped: () => 0 };
        },
        createCodec: () => ({ encode: (p) => p, decode: (o) => o }),
        createVad: () => ({ push: () => null, isOpen: false, thresholdDb: -45, levelDb: -96 }),
      },
    });
    return { voice, counts: () => ({ opened, stopped }) };
  }

  test("after the minimum uptime, during silence, a fresh pw-cat replaces the old one", async () => {
    const { voice, counts } = refreshSetup({ checkMs: 20, minUptimeMs: 40, quietMs: 0 });
    await voice.toggleVoice(VOICE_A);
    await Bun.sleep(200);
    expect(counts().opened).toBeGreaterThanOrEqual(2);
    expect(counts().stopped).toBe(counts().opened - 1);
    await voice.leaveVoice();
    expect(counts().stopped).toBe(counts().opened);
  });

  test("no refresh while someone talked recently", async () => {
    const { voice, counts } = refreshSetup({ checkMs: 20, minUptimeMs: 40, quietMs: 60_000 });
    await voice.toggleVoice(VOICE_A);
    await Bun.sleep(150);
    expect(counts().opened).toBe(1);
    await voice.leaveVoice();
  });
});
