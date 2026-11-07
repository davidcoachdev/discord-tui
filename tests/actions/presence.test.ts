import { describe, expect, test } from "bun:test";

import { createIdlePresence, DOCUMENTED_OP3 } from "../../src/actions/presence";

function fakeGateway() {
  const sent: Array<{ op: number; d: unknown }> = [];
  return {
    sent,
    send(op: number, d: unknown) {
      sent.push({ op, d });
    },
  };
}

describe("createIdlePresence", () => {
  test("idle after 10 min without keys, online on next key, one op 3 each", () => {
    let now = 0;
    const timers: Array<{ fn: () => void; at: number }> = [];
    const gateway = fakeGateway();
    const presence = createIdlePresence({
      gateway: gateway as never,
      settings: () => ({ idleAfterMinutes: 10 }),
      now: () => now,
      setTimer: ((fn: () => void, ms: number) => {
        timers.push({ fn, at: now + ms });
        return 0 as never;
      }) as never,
    });

    presence.activity();
    expect(gateway.sent).toHaveLength(0);

    now = 10 * 60_000;
    for (const timer of timers.splice(0)) timer.fn();
    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sent[0]).toEqual({ op: 3, d: { status: "idle", since: 10 * 60_000, activities: [], afk: false } });

    presence.activity();
    expect(gateway.sent).toHaveLength(2);
    expect(gateway.sent[1]?.d).toMatchObject({ status: "online", afk: false });
    presence.stop();
  });

  test("op 3 has the documented shape", () => {
    const gateway = fakeGateway();
    let now = 0;
    const timers: Array<() => void> = [];
    const presence = createIdlePresence({
      gateway: gateway as never,
      settings: () => ({ idleAfterMinutes: 1 }),
      now: () => now,
      setTimer: ((fn: () => void) => {
        timers.push(fn);
        return 0 as never;
      }) as never,
    });
    presence.activity();
    now = 60_000;
    for (const fn of timers.splice(0)) fn();
    expect(Object.keys(gateway.sent[0]!.d as object).sort()).toEqual(Object.keys(DOCUMENTED_OP3).sort());
    presence.stop();
  });

  test("idleAfterMinutes null never sends op 3", () => {
    const gateway = fakeGateway();
    const presence = createIdlePresence({
      gateway: gateway as never,
      settings: () => ({ idleAfterMinutes: null }),
      now: () => 0,
    });
    presence.activity();
    presence.stop();
    expect(gateway.sent).toHaveLength(0);
  });

  test("never sends op 3 twice while already idle", () => {
    const gateway = fakeGateway();
    let now = 0;
    const timers: Array<() => void> = [];
    const presence = createIdlePresence({
      gateway: gateway as never,
      settings: () => ({ idleAfterMinutes: 1 }),
      now: () => now,
      setTimer: ((fn: () => void) => {
        timers.push(fn);
        return 0 as never;
      }) as never,
    });
    presence.activity();
    now = 60_000;
    for (const fn of timers.splice(0)) fn();
    for (const fn of timers.splice(0)) fn();
    expect(gateway.sent).toHaveLength(1);
    presence.stop();
  });
});
