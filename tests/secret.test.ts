import { expect, test } from "bun:test";

import { Secret } from "../src/secret";
import { fakeToken } from "./helpers/fake-token";

test("Secret never reveals itself when stringified", () => {
  const s = new Secret(fakeToken());
  for (const out of [String(s), `${s}`, JSON.stringify({ s }), Bun.inspect(s), Bun.inspect({ nested: { s } })])
    expect(out).not.toContain(fakeToken());
  expect(s.reveal()).toBe(fakeToken());
});
