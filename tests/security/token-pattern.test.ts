import { expect, test } from "bun:test";

import { findTokenLike } from "../../src/security/token-pattern";
import { fakeToken } from "../helpers/fake-token";

test("findTokenLike detects a runtime-built user token", () => {
  const t = fakeToken();
  expect(findTokenLike(`Authorization: ${t}`)).toEqual([t]);
});
test("findTokenLike detects mfa tokens", () => {
  const t = "mfa." + "x".repeat(84);
  expect(findTokenLike(t)).toEqual([t]);
});
test("findTokenLike ignores snowflakes, urls and base64 images", () => {
  expect(findTokenLike("123456789012345678 https://cdn.discordapp.com/a/b.png")).toEqual([]);
});
