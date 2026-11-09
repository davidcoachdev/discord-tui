import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";

import { parseMarkdown } from "../../src/markdown/parse";
import { createStore, emptyState } from "../../src/store/store";
import { Markdown } from "../../src/ui/components/Markdown";
import { THEMES } from "../../src/ui/theme";
import { buildDemoStore } from "../../scripts/demo-state";
import { App } from "../../src/ui/App";

test("Markdown cuts a 300-line code block to 20 lines", async () => {
  const code = "```\n" + Array.from({ length: 300 }, (_, i) => `linea ${i}`).join("\n") + "\n```";
  const state = createStore(emptyState()).getState();
  const { captureCharFrame, renderOnce } = await testRender(
    () => <Markdown nodes={parseMarkdown(code)} ctx={{ state, theme: THEMES.dark, guildId: null, revealSpoilers: false }} />,
    { width: 60, height: 30 },
  );
  await renderOnce();
  const frame = captureCharFrame();
  expect(frame).toContain("linea 19");
  expect(frame).not.toContain("linea 20 ");
  expect(frame).toContain("… (280 líneas más)");
});

test("messages show resolved mentions, custom emoji, reactions, edited marker, attachments and embeds", async () => {
  const store = buildDemoStore();
  const actions = { selectGuild() {}, openChannel: async () => {}, loadOlder: async () => {}, focus() {}, toggleMembers() {}, send: async () => {}, retry: async () => {}, edit: async () => {}, remove: async () => {}, toggleReaction: async () => {} };
  const { captureCharFrame, renderOnce } = await testRender(() => <App store={store} actions={actions} onQuit={() => {}} />, {
    width: 160,
    height: 60,
  });
  await renderOnce();
  const frame = captureCharFrame();
  expect(frame).toContain("@bruno_7712 ¿che pero lo estás haciendo eso en hora?");
  expect(frame).not.toContain("<@");
  expect(frame).toContain(":kek:");
  expect(frame).toContain("😂 3");
  expect(frame).toContain("(editado)");
  expect(frame).toContain("📎 captura-20261107.png (121 KB)");
  expect(frame).toContain("OpenTUI");
  expect(frame).toContain("Celes💜 está escribiendo…");
  expect(frame).toContain("╭─ @bruno_7712");
  expect(frame).toContain("EN LÍNEA — 2");
});
