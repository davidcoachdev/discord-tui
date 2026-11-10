import { expect, test } from "bun:test";

import type { RestClient } from "../../src/rest/client";
import { lastViewedDays, postAck } from "../../src/rest/routes";

const DISCORD_EPOCH_MS = 1420070400000;
const DAY_MS = 86_400_000;

test("lastViewedDays counts days since the Discord epoch", () => {
  expect(lastViewedDays(DISCORD_EPOCH_MS)).toBe(0);
  expect(lastViewedDays(DISCORD_EPOCH_MS + 2 * DAY_MS)).toBe(2);
  expect(lastViewedDays(DISCORD_EPOCH_MS + 2 * DAY_MS - 1)).toBe(1);
});

test("postAck sends the provided token and a computed last_viewed, and returns the response token", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const rest: RestClient = {
    closed: false,
    request: async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      calls.push({ method, path, body });
      return { token: "tok-1" } as T;
    },
  };

  const now = Date.now();
  const result = await postAck(rest, "chan", "msg", { token: null, last_viewed: lastViewedDays(now) });

  expect(calls).toHaveLength(1);
  expect(calls[0]!.method).toBe("POST");
  expect(calls[0]!.path).toBe("/channels/chan/messages/msg/ack");
  expect(calls[0]!.body).toEqual({ token: null, last_viewed: lastViewedDays(now) });
  expect(result).toEqual({ token: "tok-1" });
});

test("postAck computes last_viewed when it is not provided and defaults token to null", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const rest: RestClient = {
    closed: false,
    request: async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      calls.push({ method, path, body });
      return null as T;
    },
  };

  const result = await postAck(rest, "chan", "msg");

  expect(calls[0]!.body).toEqual({ token: null, last_viewed: lastViewedDays(Date.now()) });
  expect(result).toEqual({ token: null });
});
