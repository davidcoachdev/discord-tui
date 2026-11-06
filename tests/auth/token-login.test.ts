import { expect, test } from "bun:test";

import { normalizePastedToken, validateToken } from "../../src/auth/token-login";
import { createClientProps } from "../../src/client-props/props";
import { UnauthorizedError } from "../../src/rest/errors";
import { createHttp } from "../../src/rest/http";
import { Secret } from "../../src/secret";
import { startFakeHttp } from "../fakes/fake-http";
import { fakeToken } from "../helpers/fake-token";

test("trims spaces and quotes", () => {
  const r = normalizePastedToken(`  "${fakeToken()}"\n`);
  expect(r.ok && r.token.reveal()).toBe(fakeToken());
});

test("rejects Bearer/Bot prefixes and non-token shapes", () => {
  expect(normalizePastedToken(`Bot ${fakeToken()}`)).toEqual({ ok: false, reason: "prefixed" });
  expect(normalizePastedToken(`Bearer ${fakeToken()}`)).toEqual({ ok: false, reason: "prefixed" });
  expect(normalizePastedToken("hola")).toEqual({ ok: false, reason: "shape" });
  expect(normalizePastedToken("   ")).toEqual({ ok: false, reason: "empty" });
});

test("validateToken returns the user and sends the raw token", async () => {
  const fake = startFakeHttp(() => Response.json({ id: "42", username: "gonfake" }));
  try {
    const token = new Secret(fakeToken());
    const http = createHttp({ props: createClientProps({ buildNumber: 1 }), token, baseUrl: fake.url });
    expect(await validateToken(token, http)).toEqual({ userId: "42", username: "gonfake" });
    expect(fake.requests[0]!.headers.get("authorization")).toBe(fakeToken());
  } finally {
    fake.stop();
  }
});

test("validateToken throws UnauthorizedError on 401", async () => {
  const fake = startFakeHttp(() => Response.json({ code: 40001 }, { status: 401 }));
  try {
    const token = new Secret(fakeToken());
    const http = createHttp({ props: createClientProps({ buildNumber: 1 }), token, baseUrl: fake.url });
    await expect(validateToken(token, http)).rejects.toBeInstanceOf(UnauthorizedError);
  } finally {
    fake.stop();
  }
});
