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

describe("manual status", () => {
  function setup(initial: "online" | "idle" | "dnd" | "invisible") {
    let now = 0;
    const timers: Array<() => void> = [];
    const gateway = fakeGateway();
    const settings = { idleAfterMinutes: 1 as number | null, status: initial };
    const presence = createIdlePresence({
      gateway: gateway as never,
      settings: () => settings,
      now: () => now,
      setTimer: ((fn: () => void) => {
        timers.push(fn);
        return 0 as never;
      }) as never,
      clearTimer: (() => {}) as never,
    });
    const fire = (at: number) => {
      now = at;
      for (const fn of timers.splice(0)) fn();
    };
    return { gateway, settings, presence, fire };
  }

  test("dnd and invisible are never overridden by inactivity or activity", () => {
    for (const status of ["dnd", "invisible"] as const) {
      const { gateway, presence, fire } = setup(status);
      presence.activity();
      fire(60_000);
      presence.activity();
      fire(120_000);
      expect(gateway.sent).toHaveLength(0);
      expect(presence.current()).toEqual({ status, since: 0, activities: [], afk: false });
      presence.stop();
    }
  });

  test("changing the status sends one op 3 with the documented shape and stops the automatic idle", () => {
    const { gateway, settings, presence, fire } = setup("online");
    presence.activity();
    settings.status = "dnd";
    presence.statusChanged();
    expect(gateway.sent).toEqual([{ op: 3, d: { status: "dnd", since: 0, activities: [], afk: false } }]);
    expect(Object.keys(gateway.sent[0]!.d as object).sort()).toEqual(Object.keys(DOCUMENTED_OP3).sort());
    fire(60_000);
    presence.activity();
    expect(gateway.sent).toHaveLength(1);
    presence.stop();
  });

  test("auto idle, then a manual idle, then back to online", () => {
    const { gateway, settings, presence, fire } = setup("online");
    presence.activity();
    fire(60_000);
    expect(gateway.sent.at(-1)?.d).toMatchObject({ status: "idle", since: 60_000 });
    settings.status = "idle";
    presence.statusChanged();
    // Ya estaba "idle" por inactividad: no hace falta otro op 3, y la actividad no lo saca.
    expect(gateway.sent).toHaveLength(1);
    presence.activity();
    expect(gateway.sent).toHaveLength(1);
    expect(presence.current().status).toBe("idle");
    settings.status = "online";
    presence.statusChanged();
    expect(gateway.sent.at(-1)?.d).toEqual({ status: "online", since: 0, activities: [], afk: false });
    presence.stop();
  });

  test("nothing is sent while the gateway is not ready; the resume sends the pending change", () => {
    let ready = false;
    const gateway = fakeGateway();
    const settings = { idleAfterMinutes: null, status: "online" as "online" | "dnd" };
    const presence = createIdlePresence({ gateway: gateway as never, settings: () => settings, ready: () => ready });
    settings.status = "dnd";
    presence.statusChanged();
    expect(gateway.sent).toHaveLength(0);
    ready = true;
    presence.sessionStarted("resumed");
    expect(gateway.sent).toEqual([{ op: 3, d: { status: "dnd", since: 0, activities: [], afk: false } }]);
    presence.sessionStarted("identified");
    presence.sessionStarted("resumed");
    expect(gateway.sent).toHaveLength(1);
    presence.stop();
  });
});
