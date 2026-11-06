import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "discord-tui-http-state-"));
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "discord-tui-http-config-"));

const { logPath } = await import("../../src/config/paths");
const { createClientProps } = await import("../../src/client-props/props");
const { CaptchaRequiredError, InvalidResponseError, UnauthorizedError } = await import("../../src/rest/errors");
const { createHttp } = await import("../../src/rest/http");
const { findTokenLike } = await import("../../src/security/token-pattern");
const { Secret } = await import("../../src/secret");
const { startFakeHttp } = await import("../fakes/fake-http");
const { fakeToken } = await import("../helpers/fake-token");

test("X-Super-Properties is sent on every request and decodes to the same object", async () => {
  const fake = startFakeHttp(() => Response.json({ ok: true }));
  try {
    const props = createClientProps({ buildNumber: 400000 });
    const http = createHttp({ props, baseUrl: fake.url });
    await http.request("GET", "/users/@me");
    const header = fake.requests[0]!.headers.get("x-super-properties")!;
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    expect(decoded).toEqual(props.superProperties());
  } finally {
    fake.stop();
  }
});

test("Authorization carries the raw token, no prefix", async () => {
  const fake = startFakeHttp(() => Response.json({}));
  try {
    const token = new Secret(fakeToken());
    const http = createHttp({ props: createClientProps({ buildNumber: 1 }), token, baseUrl: fake.url });
    await http.request("GET", "/users/@me");
    expect(fake.requests[0]!.headers.get("authorization")).toBe(fakeToken());
  } finally {
    fake.stop();
  }
});

test("401 throws UnauthorizedError and the log line has only method, route, status", async () => {
  const fake = startFakeHttp(() => Response.json({ code: 40001, message: "401: Unauthorized" }, { status: 401 }));
  try {
    const token = new Secret(fakeToken());
    const http = createHttp({ props: createClientProps({ buildNumber: 1 }), token, baseUrl: fake.url });
    await expect(http.request("GET", "/users/@me")).rejects.toBeInstanceOf(UnauthorizedError);

    const logFile = readFileSync(logPath(), "utf8");
    expect(findTokenLike(logFile)).toEqual([]);
    expect(logFile).not.toContain("authorization");
    expect(logFile).toContain('"status":401');
    expect(logFile).toContain('"route":"/users/@me"');
  } finally {
    fake.stop();
  }
});

test("captcha body throws CaptchaRequiredError", async () => {
  const fake = startFakeHttp(() =>
    Response.json({ captcha_key: ["captcha-required"], captcha_sitekey: "x" }, { status: 400 }),
  );
  try {
    const http = createHttp({ props: createClientProps({ buildNumber: 1 }), baseUrl: fake.url });
    await expect(http.request("POST", "/users/@me/remote-auth/login", { ticket: "t" })).rejects.toBeInstanceOf(
      CaptchaRequiredError,
    );
  } finally {
    fake.stop();
  }
});

test("captcha body throws CaptchaRequiredError even with 200", async () => {
  const fake = startFakeHttp(() => Response.json({ captcha_key: ["captcha-required"], captcha_sitekey: "x" }));
  try {
    const http = createHttp({ props: createClientProps({ buildNumber: 1 }), baseUrl: fake.url });
    await expect(http.request("POST", "/users/@me/remote-auth/login", { ticket: "t" })).rejects.toBeInstanceOf(
      CaptchaRequiredError,
    );
  } finally {
    fake.stop();
  }
});

test("200 with a non-JSON body throws InvalidResponseError with the content type", async () => {
  const fake = startFakeHttp(() => new Response("<html>nope</html>", { headers: { "content-type": "text/html" } }));
  try {
    const http = createHttp({ props: createClientProps({ buildNumber: 1 }), baseUrl: fake.url });
    const error = (await http.request("POST", "/users/@me/remote-auth/login", { ticket: "t" }).catch(
      (caught) => caught,
    )) as InstanceType<typeof InvalidResponseError>;
    expect(error).toBeInstanceOf(InvalidResponseError);
    expect(error.contentType).toContain("text/html");
    expect(error.bytes).toBeGreaterThan(0);
  } finally {
    fake.stop();
  }
});

test("request keeps the base path (/api/v9)", async () => {
  const fake = startFakeHttp(() => Response.json({ ok: true }));
  try {
    const http = createHttp({ props: createClientProps({ buildNumber: 1 }), baseUrl: `${fake.url}/api/v9` });
    await http.request("GET", "/users/@me");
    expect(new URL(fake.requests[0]!.url).pathname).toBe("/api/v9/users/@me");
  } finally {
    fake.stop();
  }
});

test("default base URL is https://discord.com/api/v9", async () => {
  let seen = "";
  const fakeFetch = (async (input: RequestInfo | URL) => {
    seen = String(input);
    return Response.json({});
  }) as unknown as typeof fetch;
  const http = createHttp({ props: createClientProps({ buildNumber: 1 }), fetch: fakeFetch });
  await http.request("GET", "/users/@me");
  expect(seen).toBe("https://discord.com/api/v9/users/@me");
});
