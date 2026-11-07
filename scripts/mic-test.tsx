import { createCliRenderer } from "@opentui/core";
import { render, useKeyboard } from "@opentui/solid";
import { createSignal, onCleanup, onMount, type JSX } from "solid-js";

import { startCapture, startPlayback, type AudioCapture, type AudioPlayback } from "../src/voice/audio-io";
import { createEcho } from "../src/voice/echo";
import { createOpusCodec } from "../src/voice/opus";
import { createVad } from "../src/voice/vad";
import { LevelMeter } from "../src/ui/components/LevelMeter";

function MicTest(props: { onQuit: () => void }): JSX.Element {
  const [gate, setGate] = createSignal<"vad" | "always">("vad");
  const [sensitivity, setSensitivity] = createSignal<"auto" | number>("auto");
  const [level, setLevel] = createSignal(-96);
  const [threshold, setThreshold] = createSignal(-45);
  const [open, setOpen] = createSignal(false);
  const [status, setStatus] = createSignal("abriendo…");
  const [statsLine, setStatsLine] = createSignal("");

  let capture: AudioCapture | null = null;
  let playback: AudioPlayback | null = null;
  let echo: ReturnType<typeof createEcho> | null = null;
  const vadRef = { current: createVad() };

  onMount(() => {
    void (async () => {
      try {
        capture = await startCapture();
        playback = await startPlayback();
        echo = createEcho({
          capture,
          playback,
          codec: createOpusCodec(),
          vad: () => vadRef.current,
          gate: () => gate(),
        });
        capture.onFrame(() => {
          setLevel(vadRef.current.levelDb);
          setThreshold(vadRef.current.thresholdDb);
          setOpen(vadRef.current.isOpen);
        });
        setStatus("listo · g cambia de modo, +/- sensibilidad, a auto, q sale");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    })();
  });

  useKeyboard((key) => {
    if (key.name === "q") {
      props.onQuit();
      return;
    }
    if (key.name === "g") {
      setGate((previous) => (previous === "vad" ? "always" : "vad"));
      return;
    }
    if (key.name === "a") {
      setSensitivity("auto");
      vadRef.current = createVad({ sensitivity: "auto" });
      return;
    }
    if (key.name === "+" || key.name === "=") {
      const next = (sensitivity() === "auto" ? vadRef.current.thresholdDb : (sensitivity() as number)) + 3;
      setSensitivity(next);
      vadRef.current = createVad({ sensitivity: next });
      return;
    }
    if (key.name === "-") {
      const next = (sensitivity() === "auto" ? vadRef.current.thresholdDb : (sensitivity() as number)) - 3;
      setSensitivity(next);
      vadRef.current = createVad({ sensitivity: next });
    }
  });

  onCleanup(() => {
    if (echo) setStatsLine(JSON.stringify(echo.stats()));
    void echo?.stop();
  });

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      <text>discord-tui · prueba de micrófono (eco local, no toca la cuenta)</text>
      <text>{`modo: ${gate()} · sensibilidad: ${sensitivity() === "auto" ? "auto" : `${sensitivity()} dBFS`}`}</text>
      <LevelMeter levelDb={level()} thresholdDb={threshold()} open={open()} width={40} />
      <text>{`${level().toFixed(1)} dBFS · umbral ${threshold().toFixed(1)} dBFS`}</text>
      <text>{status()}</text>
      <text>{statsLine()}</text>
    </box>
  );
}

async function main(): Promise<void> {
  const renderer = await createCliRenderer({ useKittyKeyboard: { events: true } });
  const quit = (): void => {
    renderer.destroy();
    void renderer.closed.then(() => process.exit(0));
  };
  await render(() => <MicTest onQuit={quit} />, renderer);
}

if (import.meta.main) await main();
