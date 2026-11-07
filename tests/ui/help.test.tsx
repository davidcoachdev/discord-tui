import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";

import { HelpOverlay } from "../../src/ui/components/HelpOverlay";

describe("HelpOverlay", () => {
  test("lists every group with its keys and descriptions", async () => {
    const { captureCharFrame, renderOnce } = await testRender(() => <HelpOverlay onClose={() => {}} />, {
      width: 100,
      height: 40,
    });
    await renderOnce();
    const frame = captureCharFrame();
    expect(frame).toContain("Navegación");
    expect(frame).toContain("Mensajes");
    expect(frame).toContain("Voz");
    expect(frame).toContain("App");
    expect(frame).toContain("salir");
  });
});
