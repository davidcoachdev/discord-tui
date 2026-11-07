import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import type { Actions } from "../../src/actions";
import { createStore, emptyState } from "../../src/store/store";
import { SettingsScreen, type SettingsDeps } from "../../src/ui/screens/SettingsScreen";

function setup(inVoice = false) {
  const store = createStore(emptyState());
  const actions = {} as Actions;
  const captured: Array<{ target?: string }> = [];
  const played: Array<{ target?: string }> = [];
  let stopped = 0;

  const fakeCapture = {
    onFrame(fn: (pcm: Uint8Array) => void) {
      fakeCapture.listener = fn;
      return () => {};
    },
    async stop() {
      stopped += 1;
    },
    listener: null as null | ((pcm: Uint8Array) => void),
  };
  const fakePlayback = {
    write() {},
    async stop() {},
    dropped: () => 0,
  };

  const deps: SettingsDeps = {
    listAudioDevices: async () => ({
      inputs: [
        { name: "mic1", description: "Mic 1" },
        { name: "mic2", description: "Mic 2" },
      ],
      outputs: [
        { name: "spk1", description: "Speaker 1" },
        { name: "spk2", description: "Speaker 2" },
      ],
    }),
    startCapture: async (opts) => {
      captured.push(opts ?? {});
      return fakeCapture as any;
    },
    startPlayback: async (opts) => {
      played.push(opts ?? {});
      return fakePlayback as any;
    },
  };

  return { store, actions, deps, captured, played, fakeCapture, inVoice, stopped: () => stopped };
}

describe("SettingsScreen", () => {
  test("lists devices from the fake pw-dump and saves the choice", async () => {
    const { store, actions, deps } = setup();
    const { mockInput, renderOnce } = await testRender(() => (
      <SettingsScreen store={store} actions={actions} deps={deps} inVoice={false} onClose={() => {}} />
    ));
    await renderOnce();
    mockInput.pressKey("l");
    await renderOnce();
    expect(store.getState().settings.inputDevice).toBe("mic1");
    mockInput.pressKey("l");
    await renderOnce();
    expect(store.getState().settings.inputDevice).toBe("mic2");
  });

  test("sensitivity h/l moves 3 dB and persists", async () => {
    const { store, actions, deps } = setup();
    store.dispatch({ type: "settings/set", patch: { vadSensitivity: -45 } });
    const { mockInput, renderOnce } = await testRender(() => (
      <SettingsScreen store={store} actions={actions} deps={deps} inVoice={false} onClose={() => {}} />
    ));
    await renderOnce();
    for (let i = 0; i < 3; i += 1) mockInput.pressKey("j");
    await renderOnce();
    mockInput.pressKey("l");
    await renderOnce();
    expect(store.getState().settings.vadSensitivity).toBe(-42);
  });

  test("probar mic starts and stops the echo", async () => {
    const { store, actions, deps, captured, stopped } = setup();
    const { mockInput, renderOnce } = await testRender(() => (
      <SettingsScreen store={store} actions={actions} deps={deps} inVoice={false} onClose={() => {}} />
    ));
    await renderOnce();
    for (let i = 0; i < 4; i += 1) mockInput.pressKey("j");
    await renderOnce();
    mockInput.pressEnter();
    await Bun.sleep(10);
    await renderOnce();
    expect(captured.length).toBe(1);
    mockInput.pressEnter();
    await Bun.sleep(10);
    await renderOnce();
    expect(stopped()).toBe(1);
  });

  test("probar mic is disabled while in voice", async () => {
    const { store, actions, deps, captured } = setup(true);
    const { mockInput, renderOnce, captureCharFrame } = await testRender(() => (
      <SettingsScreen store={store} actions={actions} deps={deps} inVoice={true} onClose={() => {}} />
    ));
    await renderOnce();
    for (let i = 0; i < 4; i += 1) mockInput.pressKey("j");
    await renderOnce();
    mockInput.pressEnter();
    await Bun.sleep(10);
    await renderOnce();
    expect(captured.length).toBe(0);
    expect(captureCharFrame()).toContain("salí de voz");
  });

  test("Esc closes", async () => {
    const { store, actions, deps } = setup();
    let closed = 0;
    const { mockInput, renderOnce } = await testRender(() => (
      <SettingsScreen store={store} actions={actions} deps={deps} inVoice={false} onClose={() => (closed += 1)} />
    ));
    await renderOnce();
    mockInput.pressKeys(["\u001b[27u"]);
    await Bun.sleep(1);
    await renderOnce();
    expect(closed).toBe(1);
  });
});
