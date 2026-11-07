import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import { LevelMeter, meterRow } from "../../src/ui/components/LevelMeter";

describe("meterRow", () => {
  test("draws the threshold marker and the speaking dot", () => {
    const row = meterRow(-30, -40, true, 30);
    expect(row).toContain("|");
    expect(row).toContain("● hablando");
  });

  test("quiet input reads as callado", () => {
    const row = meterRow(-96, -40, false, 30);
    expect(row).toContain("callado");
    expect(row).not.toContain("●");
  });

  test("the bar never exceeds the given width", () => {
    const row = meterRow(0, -60, true, 20);
    const bar = row.split(" ")[0]!;
    expect(bar.length).toBe(20);
  });
});

describe("LevelMeter", () => {
  test("renders its rows", async () => {
    const { renderer, captureCharFrame, renderOnce } = await testRender(() => (
      <LevelMeter levelDb={-20} thresholdDb={-40} open={true} width={24} />
    ));
    await renderOnce();
    const frame = captureCharFrame();
    expect(frame).toContain("hablando");
    renderer.destroy();
  });
});
