import { expect, test } from "bun:test";
import { join } from "node:path";

import {
  extractBuildNumber,
  FALLBACK_BUILD_NUMBER,
  fetchBuildNumber,
} from "../../src/client-props/build-number";

const shellPath = join(import.meta.dir, "../fixtures/web/app-shell.html");

test("extractBuildNumber finds the number in a minified asset", () => {
  expect(extractBuildNumber('x={buildNumber:"412345",y:1}')).toBe(412345);
  expect(extractBuildNumber("nothing here")).toBeNull();
});

test("extractBuildNumber reads GLOBAL_ENV from the app shell fixture", async () => {
  const shell = await Bun.file(shellPath).text();
  expect(extractBuildNumber(shell)).toBe(663810);
});

test("fetchBuildNumber falls back to cache, then to the constant", async () => {
  const failing = async () => {
    throw new TypeError("network");
  };
  expect(await fetchBuildNumber({ fetch: failing as any, cached: 400000 })).toEqual({
    value: 400000,
    source: "cache",
  });
  expect(await fetchBuildNumber({ fetch: failing as any })).toEqual({
    value: FALLBACK_BUILD_NUMBER,
    source: "fallback",
  });
});

test("fetchBuildNumber reads the number live from the app shell", async () => {
  const shell = await Bun.file(shellPath).text();
  const okFetch = (async () => new Response(shell)) as unknown as typeof fetch;
  expect(await fetchBuildNumber({ fetch: okFetch })).toEqual({ value: 663810, source: "live" });
});
