import { expect, test } from "bun:test";

import { validateOutgoing } from "../../src/ui/composer-state";

test("validateOutgoing", () => {
  expect(validateOutgoing("", 0)).toEqual({ ok: false, reason: "empty" });
  expect(validateOutgoing("", 1)).toEqual({ ok: true });
  expect(validateOutgoing("x".repeat(2001), 0)).toEqual({ ok: false, reason: "too_long" });
  expect(validateOutgoing("hola", 0)).toEqual({ ok: true });
});
