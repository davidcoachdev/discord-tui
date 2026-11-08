import { expect, test } from "bun:test";

import { JUMBO_MAX, jumboEmoji } from "../../src/markdown/jumbo";
import { parseMarkdown } from "../../src/markdown/parse";

const only = (src: string) => jumboEmoji(parseMarkdown(src));

test("a message of custom emoji only is jumbo, animated flag included", () => {
  expect(only("<:kek:100000000000000401><a:baile:100000000000000402>")).toEqual([
    { kind: "custom", name: "kek", id: "100000000000000401", animated: false },
    { kind: "custom", name: "baile", id: "100000000000000402", animated: true },
  ]);
});

test("unicode emoji (with skin tones, ZWJ sequences, flags, keycaps) count as emoji", () => {
  expect(only("😂👍🏽")).toEqual([
    { kind: "unicode", text: "😂" },
    { kind: "unicode", text: "👍🏽" },
  ]);
  expect(only("👨‍👩‍👧 🇦🇷 1️⃣ ❤️")?.map((e) => e.kind === "unicode" && e.text)).toEqual(["👨‍👩‍👧", "🇦🇷", "1️⃣", "❤️"]);
});

test("custom and unicode mixed, whitespace and newlines ignored", () => {
  expect(only("  <:kek:100000000000000401> 😂\n <:kek:100000000000000401>  ")).toEqual([
    { kind: "custom", name: "kek", id: "100000000000000401", animated: false },
    { kind: "unicode", text: "😂" },
    { kind: "custom", name: "kek", id: "100000000000000401", animated: false },
  ]);
});

test("27 emoji are jumbo, 28 are not", () => {
  expect(only("<:a:1>".repeat(JUMBO_MAX))?.length).toBe(27);
  expect(only("<:a:1>".repeat(JUMBO_MAX + 1))).toBeNull();
  expect(only("😂".repeat(JUMBO_MAX + 1))).toBeNull();
});

test("any text, markdown or mention makes it a normal message", () => {
  expect(only("jaja <:kek:100000000000000401>")).toBeNull();
  expect(only("<:kek:100000000000000401>!")).toBeNull();
  expect(only("1")).toBeNull();
  expect(only("**<:kek:100000000000000401>**")).toBeNull();
  expect(only("<@900000000000000001> 😂")).toBeNull();
  expect(only("   ")).toBeNull();
  expect(only("")).toBeNull();
});
