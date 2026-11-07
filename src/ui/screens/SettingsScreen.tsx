import { useKeyboard } from "@opentui/solid";
import { createResource, createSignal, onCleanup, Show, type JSX } from "solid-js";

import type { Actions } from "../../actions";
import type { Store } from "../../store/store";
import { createEcho, type Echo } from "../../voice/echo";
import { createOpusCodec } from "../../voice/opus";
import { createVad } from "../../voice/vad";
import type { AudioDevice } from "../../voice/devices";
import { LevelMeter } from "../components/LevelMeter";
import { useSelector } from "../store-bridge";

export interface SettingsDeps {
  listAudioDevices(): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[] }>;
  startCapture: (opts?: { target?: string }) => Promise<any>;
  startPlayback: (opts?: { target?: string }) => Promise<any>;
}

type Section = "input" | "output" | "inputMode" | "sensitivity" | "testMic" | "theme";
const SECTIONS: Section[] = ["input", "output", "inputMode", "sensitivity", "testMic", "theme"];

export function SettingsScreen(props: {
  store: Store;
  actions: Actions;
  deps: SettingsDeps;
  inVoice: boolean;
  onClose(): void;
}): JSX.Element {
  const settings = useSelector(props.store, (state) => state.settings);
  const [devices] = createResource(() => props.deps.listAudioDevices());
  const [row, setRow] = createSignal<Section>("input");
  const [testing, setTesting] = createSignal(false);
  const [level, setLevel] = createSignal(-96);
  const [threshold, setThreshold] = createSignal(-45);
  const [open, setOpen] = createSignal(false);

  let echo: Echo | null = null;

  function patch(fields: Partial<typeof settings extends () => infer T ? T : never>): void {
    props.store.dispatch({ type: "settings/set", patch: fields });
  }

  async function startTest(): Promise<void> {
    if (props.inVoice || testing()) return;
    const capture = await props.deps.startCapture({ target: settings().inputDevice ?? undefined });
    const playback = await props.deps.startPlayback({ target: settings().outputDevice ?? undefined });
    const vad = createVad({ sensitivity: settings().vadSensitivity });
    echo = createEcho({ capture, playback, codec: createOpusCodec(), vad, gate: "always" });
    capture.onFrame(() => {
      setLevel(vad.levelDb);
      setThreshold(vad.thresholdDb);
      setOpen(vad.isOpen);
    });
    setTesting(true);
  }

  async function stopTest(): Promise<void> {
    if (!testing()) return;
    await echo?.stop();
    echo = null;
    setTesting(false);
  }

  function cycleDevice(kind: "input" | "output", delta: number): void {
    const list = kind === "input" ? devices()?.inputs : devices()?.outputs;
    if (!list || list.length === 0) return;
    const field = kind === "input" ? "inputDevice" : "outputDevice";
    const current = settings()[field];
    const index = list.findIndex((d) => d.name === current);
    const next = list[(index + delta + list.length) % list.length];
    if (next) patch({ [field]: next.name } as never);
  }

  function nudgeSensitivity(deltaDb: number): void {
    const current = settings().vadSensitivity;
    const base = current === "auto" ? threshold() : current;
    patch({ vadSensitivity: Math.min(-20, Math.max(-60, base + deltaDb)) });
  }

  useKeyboard((key) => {
    if (key.name === "escape") {
      props.onClose();
      return;
    }
    if (key.name === "j") {
      const index = SECTIONS.indexOf(row());
      setRow(SECTIONS[Math.min(SECTIONS.length - 1, index + 1)]!);
      return;
    }
    if (key.name === "k") {
      const index = SECTIONS.indexOf(row());
      setRow(SECTIONS[Math.max(0, index - 1)]!);
      return;
    }
    if (row() === "input" && (key.name === "h" || key.name === "l")) {
      cycleDevice("input", key.name === "l" ? 1 : -1);
      return;
    }
    if (row() === "output" && (key.name === "h" || key.name === "l")) {
      cycleDevice("output", key.name === "l" ? 1 : -1);
      return;
    }
    if (row() === "inputMode" && key.name === "return") {
      patch({ inputMode: settings().inputMode === "voice_activity" ? "push_to_talk" : "voice_activity" });
      return;
    }
    if (row() === "sensitivity") {
      if (key.name === "h") nudgeSensitivity(-3);
      if (key.name === "l") nudgeSensitivity(3);
      if (key.name === "a") patch({ vadSensitivity: "auto" });
      return;
    }
    if (row() === "testMic" && key.name === "return") {
      if (testing()) void stopTest();
      else void startTest();
      return;
    }
    if (row() === "theme" && key.name === "return") {
      patch({ theme: settings().theme === "dark" ? "light" : "dark" });
    }
  });

  onCleanup(() => {
    void stopTest();
  });

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      <text>Settings · j/k mueve, Enter cambia, h/l ajusta, Esc cierra</text>
      <text>{`${row() === "input" ? "> " : "  "}entrada: ${settings().inputDevice ?? "predeterminada"}`}</text>
      <text>{`${row() === "output" ? "> " : "  "}salida: ${settings().outputDevice ?? "predeterminada"}`}</text>
      <text>
        {`${row() === "inputMode" ? "> " : "  "}modo de entrada: ${
          settings().inputMode === "voice_activity" ? "Actividad de voz" : "Push-to-Talk"
        }`}
      </text>
      <text>
        {`${row() === "sensitivity" ? "> " : "  "}sensibilidad: ${
          settings().vadSensitivity === "auto" ? "auto" : `${settings().vadSensitivity} dBFS`
        }`}
      </text>
      <Show when={testing()}>
        <LevelMeter levelDb={level()} thresholdDb={threshold()} open={open()} width={40} />
      </Show>
      <text>
        {`${row() === "testMic" ? "> " : "  "}${
          props.inVoice ? "salí de voz para probar el mic" : testing() ? "probando mic · Enter detiene" : "probar mic · Enter"
        }`}
      </text>
      <text>{`${row() === "theme" ? "> " : "  "}tema: ${settings().theme === "dark" ? "oscuro" : "claro"}`}</text>
    </box>
  );
}
