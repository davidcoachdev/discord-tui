import { expect, test } from "bun:test";

import { createRestClient, routeKey } from "../../src/rest/client";
import { RateLimitedError, UnauthorizedError } from "../../src/rest/errors";
import type { Http } from "../../src/rest/http";
import { getMessages } from "../../src/rest/routes";

test("routeKey keeps major params and strips other ids", () => {
  expect(routeKey("GET", "/channels/123456789012345678/messages/223456789012345678?limit=50")).toBe(
    "GET /channels/123456789012345678/messages/:id",
  );
  expect(routeKey("GET", "/users/@me")).toBe("GET /users/@me");
  expect(routeKey("POST", "/guilds/123456789012345678/channels")).toBe("POST /guilds/123456789012345678/channels");
});

test("same route is serialized, different routes run in parallel", async () => {
  const active = new Map<string, number>();
  let maxSame = 0;
  let total = 0;
  let maxTotal = 0;

  const http: Http = {
    request: async <T>(_method: string, path: string): Promise<T> => {
      total += 1;
      maxTotal = Math.max(maxTotal, total);
      active.set(path, (active.get(path) ?? 0) + 1);
      maxSame = Math.max(maxSame, active.get(path)!);
      await Bun.sleep(20);
      active.set(path, active.get(path)! - 1);
      total -= 1;
      return {} as T;
    },
  };

  const rest = createRestClient({ http, onUnauthorized: () => {} });
  await Promise.all([
    rest.request("GET", "/channels/1/messages"),
    rest.request("GET", "/channels/1/messages"),
    rest.request("GET", "/users/@me"),
  ]);

  expect(maxSame).toBe(1);
  expect(maxTotal).toBeGreaterThanOrEqual(2);
});

test("429 waits retry_after and retries", async () => {
  let calls = 0;
  const http: Http = {
    request: async <T>(): Promise<T> => {
      calls += 1;
      if (calls === 1) throw new RateLimitedError("/channels/1/messages", 50, false, null);
      return { ok: true } as T;
    },
  };

  const rest = createRestClient({ http, onUnauthorized: () => {} });
  const started = Date.now();
  await rest.request("GET", "/channels/1/messages");
  expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  expect(calls).toBe(2);
});

test("global 429 pauses every route", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  let aCalls = 0;
  let bStarted = false;
  const http: Http = {
    request: async <T>(_method: string, path: string): Promise<T> => {
      if (path === "/a") {
        aCalls += 1;
        if (aCalls === 1) throw new RateLimitedError("/a", 60, true, null);
        return {} as T;
      }
      bStarted = true;
      return {} as T;
    },
  };

  const rest = createRestClient({
    http,
    onUnauthorized: () => {},
    sleep: async () => {
      await gate;
    },
  });

  const a = rest.request("GET", "/a");
  await Bun.sleep(10);
  const b = rest.request("GET", "/b");
  await Bun.sleep(10);

  expect(bStarted).toBe(false);
  release();
  await Promise.all([a, b]);
  expect(bStarted).toBe(true);
});

test("gives up after 3 consecutive 429s with RateLimitedError", async () => {
  let calls = 0;
  const http: Http = {
    request: async <T>(): Promise<T> => {
      calls += 1;
      throw new RateLimitedError("/x", 1, false, null);
    },
  };

  const rest = createRestClient({ http, onUnauthorized: () => {} });
  await expect(rest.request("GET", "/x")).rejects.toBeInstanceOf(RateLimitedError);
  expect(calls).toBe(3);
});

test("401 calls onUnauthorized once and later requests fail without touching the network", async () => {
  let calls = 0;
  let unauthorized = 0;
  const http: Http = {
    request: async <T>(): Promise<T> => {
      calls += 1;
      throw new UnauthorizedError("/users/@me");
    },
  };

  const rest = createRestClient({
    http,
    onUnauthorized: () => {
      unauthorized += 1;
    },
  });

  await expect(rest.request("GET", "/users/@me")).rejects.toBeInstanceOf(UnauthorizedError);
  expect(rest.closed).toBe(true);
  await expect(rest.request("GET", "/users/@me")).rejects.toBeInstanceOf(UnauthorizedError);

  expect(unauthorized).toBe(1);
  expect(calls).toBe(1);
});

test("getMessages builds the paged history request", async () => {
  let seen = "";
  const http: Http = {
    request: async <T>(method: string, path: string): Promise<T> => {
      seen = `${method} ${path}`;
      return [] as T;
    },
  };

  const rest = createRestClient({ http, onUnauthorized: () => {} });
  await getMessages(rest, "123456789012345678", { before: "223456789012345678" });
  expect(seen).toBe("GET /channels/123456789012345678/messages?limit=50&before=223456789012345678");
});
