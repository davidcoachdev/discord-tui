import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import { assertTty } from "../../src/main";
import { App } from "../../src/ui/App";

test("renders the three empty columns and the status bar", async () => {
  const { captureCharFrame, renderOnce } = await testRender(() => <App onQuit={() => {}} />, { width: 100, height: 30 });
  await renderOnce();
  const f = captureCharFrame();
  for (const s of ["Servidores", "Canales", "Mensajes", "desconectado"]) expect(f).toContain(s);
});

test("q calls onQuit", async () => {
  let quit = 0;
  const { mockInput, renderOnce } = await testRender(() => <App onQuit={() => quit++} />, { width: 100, height: 30 });
  mockInput.pressKey("q");
  await renderOnce();
  expect(quit).toBe(1);
});

test("assertTty", () => {
  expect(assertTty({ isTTY: false })).toBe("discord-tui necesita una terminal");
  expect(assertTty({ isTTY: true })).toBeNull();
});

test("tiny terminal still renders", async () => {
  const { renderOnce } = await testRender(() => <App onQuit={() => {}} />, { width: 40, height: 10 });
  await expect(renderOnce()).resolves.toBeUndefined();
});
