import { expect, test } from "bun:test";

import { openUrl } from "../../src/proc/open-url";

test("openUrl only opens https links, as an argv (no shell)", () => {
  const calls: string[][] = [];
  const spawn = (cmd: string[]) => void calls.push(cmd);
  expect(openUrl("https://cdn.discordapp.com/x.png", { spawn })).toBe(true);
  expect(openUrl("http://example.com", { spawn })).toBe(false);
  expect(openUrl("file:///etc/passwd", { spawn })).toBe(false);
  expect(openUrl("javascript:alert(1)", { spawn })).toBe(false);
  expect(openUrl("no es un link", { spawn })).toBe(false);
  expect(calls).toEqual([["xdg-open", "https://cdn.discordapp.com/x.png"]]);
});
