import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import type { Actions } from "../../src/actions";
import type { VoiceActions } from "../../src/actions/voice";
import { App } from "../../src/ui/App";
import { buildDemoStore, DEMO } from "../../scripts/demo-state";

function setup() {
  const store = buildDemoStore();
  const calls: string[] = [];
  const voice: VoiceActions = {
    toggleVoice: async (id) => void calls.push(`toggle:${id}`),
    leaveVoice: async () => void calls.push("leave"),
    toggleMute: () => void calls.push("mute"),
    toggleDeaf: () => void calls.push("deaf"),
    setInputMode: (m) => void calls.push(`mode:${m}`),
    toggleInputMode: () => void calls.push("inputMode"),
    pttKey: (e) => void calls.push(`ptt:${e.eventType}`),
    micLevel: () => null,
  };
  const actions: Actions = {
    selectGuild: (id) => store.dispatch({ type: "ui/selectGuild", id }),
    openChannel: async (id) => store.dispatch({ type: "ui/selectChannel", id }),
    loadOlder: async () => {},
    focus: (focus) => store.dispatch({ type: "ui/focus", focus }),
    toggleMembers: () => store.dispatch({ type: "ui/toggleMembers" }),
    send: async () => {},
    retry: async () => {},
    edit: async () => {},
    remove: async () => {},
    toggleReaction: async () => {},
    voice,
  };
  return { store, actions, calls };
}

async function render(setupResult: ReturnType<typeof setup>, width = 160, height = 45) {
  return testRender(() => <App store={setupResult.store} actions={setupResult.actions} onQuit={() => {}} />, { width, height });
}

test("participants appear under the voice channel with mute/deaf badges", async () => {
  const s = setup();
  const { captureCharFrame, renderOnce } = await render(s);
  await renderOnce();
  const frame = captureCharFrame();
  expect(frame).toContain("🔊 Sala 1");
  expect(frame).toMatch(/○ Ragnar/);
  expect(frame).toMatch(/CinLo💜\s+\[mute\]/);
  expect(frame).toMatch(/PmmR\s+\[deaf\]/);
});

test("connected bar shows channel, E2EE with the privacy code, input mode and who speaks", async () => {
  const s = setup();
  s.store.dispatch({ type: "voice/joining", guildId: DEMO.guild, channelId: DEMO.voice });
  s.store.dispatch({ type: "voice/status", status: "connected" });
  s.store.dispatch({ type: "voice/privacyCode", code: "1234512345" });
  s.store.dispatch({ type: "voice/speaking", userId: "900000000000000101", on: true });
  s.store.dispatch({ type: "voice/selfSpeaking", on: true });
  s.store.dispatch({ type: "voice/flags", selfMute: true, selfDeaf: false, muteBeforeDeaf: false });
  const { captureCharFrame, renderOnce } = await render(s);
  await renderOnce();
  const frame = captureCharFrame();
  expect(frame).toContain("🔊 Sala 1 · Mu Gondor · 🔒 E2EE 12345 12345 · VAD · ● vos [mute]");
  expect(frame).toContain("hablando: Ragnar");
  expect(frame).toMatch(/● Ragnar/);
});

test("a voice error is shown in the bar", async () => {
  const s = setup();
  s.store.dispatch({ type: "voice/left", error: "Discord exige cifrado E2EE (DAVE) y no se pudo negociar" });
  const { captureCharFrame, renderOnce } = await render(s);
  await renderOnce();
  expect(captureCharFrame()).toContain("✗ voz: Discord exige cifrado E2EE (DAVE) y no se pudo negociar");
});

test("v on a selected voice channel toggles voice; Enter on it too", async () => {
  const s = setup();
  s.store.dispatch({ type: "ui/selectChannel", id: DEMO.voice });
  s.store.dispatch({ type: "ui/focus", focus: "channels" });
  const { mockInput, renderOnce } = await render(s);
  await renderOnce();
  mockInput.pressKey("v");
  mockInput.pressEnter();
  await renderOnce();
  expect(s.calls).toEqual([`toggle:${DEMO.voice}`, `toggle:${DEMO.voice}`]);
});

test("v on a text channel while connected leaves voice", async () => {
  const s = setup();
  s.store.dispatch({ type: "voice/joining", guildId: DEMO.guild, channelId: DEMO.voice });
  const { mockInput, renderOnce } = await render(s);
  await renderOnce();
  mockInput.pressKey("v");
  await renderOnce();
  expect(s.calls).toEqual(["leave"]);
});

test("m, D and M dispatch mute, deafen and input mode", async () => {
  const s = setup();
  const { mockInput, renderOnce } = await render(s);
  await renderOnce();
  mockInput.pressKey("m");
  mockInput.pressKey("D");
  mockInput.pressKey("M");
  await renderOnce();
  expect(s.calls).toEqual(["mute", "deaf", "inputMode"]);
});

test("space goes to PTT only in normal mode; typing in the composer does not transmit", async () => {
  const s = setup();
  const { mockInput, renderOnce } = await render(s);
  await renderOnce();
  mockInput.pressKey(" ");
  mockInput.pressKey("i");
  mockInput.pressKey(" ");
  await renderOnce();
  expect(s.calls).toEqual(["ptt:press"]);
});
