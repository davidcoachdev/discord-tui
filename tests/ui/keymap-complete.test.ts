import { describe, expect, test } from "bun:test";

import { SPEC_KEYS, keysByGroup } from "../../src/ui/keys";

describe("SPEC_KEYS", () => {
  test("every key of the spec table has a spanish description", () => {
    for (const entry of SPEC_KEYS) {
      expect(entry.desc.length).toBeGreaterThan(0);
      expect(entry.group).toBeTruthy();
    }
  });

  test("covers the keys documented in the spec 7.5 table", () => {
    const keys = SPEC_KEYS.map((entry) => entry.key);
    for (const expected of ["j", "k", "h", "l", "gg", "G", "i", "Esc", "r", "e", "dd", "+", "?", "q"]) {
      expect(keys).toContain(expected);
    }
  });

  test("covers our own decisions (R, gm, gs)", () => {
    const keys = SPEC_KEYS.map((entry) => entry.key);
    expect(keys).toContain("R");
    expect(keys).toContain("gm");
    expect(keys).toContain("gs");
  });

  test("keysByGroup groups by the declared group", () => {
    const groups = keysByGroup();
    expect(groups.get("App")?.some((entry) => entry.key === "q")).toBe(true);
    expect(groups.get("Voz")?.some((entry) => entry.key === "v")).toBe(true);
  });
});
