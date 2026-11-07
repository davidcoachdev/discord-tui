import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { listAudioDevices, resolveTarget } from "../../src/voice/devices";

const fixture = readFileSync(join(import.meta.dir, "..", "fixtures", "pw-dump.json"), "utf8");

function fakeSpawn(stdout: string) {
  return (() =>
    ({
      stdout: new Response(stdout).body,
      exited: Promise.resolve(0),
    }) as never) as never;
}

describe("listAudioDevices", () => {
  test("splits sources and sinks from pw-dump, ignoring non-audio nodes", async () => {
    const devices = await listAudioDevices({ spawn: fakeSpawn(fixture) as never });
    expect(devices.inputs).toEqual([
      { name: "alsa_input.usb-Blue_Microphones-00.analog-stereo", description: "Blue Yeti Analog Stereo" },
    ]);
    expect(devices.outputs).toEqual([
      { name: "alsa_output.pci-0000_00_1f.3.analog-stereo", description: "Built-in Audio Analog Stereo" },
      { name: "bluez_output.AA_BB.1", description: "Auriculares USB" },
    ]);
  });
});

describe("resolveTarget", () => {
  const devices = [
    { name: "a", description: "A" },
    { name: "b", description: "B" },
  ];

  test("returns the saved device when it exists", () => {
    expect(resolveTarget("b", devices)).toEqual({ target: "b", warning: null });
  });

  test("null saved device uses the system default silently", () => {
    expect(resolveTarget(null, devices)).toEqual({ target: null, warning: null });
  });

  test("missing saved device warns and falls back to null", () => {
    expect(resolveTarget("c", devices)).toEqual({
      target: null,
      warning: "no encontré c, uso el predeterminado",
    });
  });
});
