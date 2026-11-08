import { expect, test } from "bun:test";

import { createActions } from "../../src/actions";
import { createStatusSync, ECHO_GRACE_MS, STATUS_SYNC_NOTICE } from "../../src/actions/status-sync";
import { encodeStatusPatch } from "../../src/proto/settings";
import type { RestClient } from "../../src/rest/client";
import { HttpError } from "../../src/rest/errors";
import type { OwnStatus } from "../../src/settings/settings";
import { createStore, emptyState } from "../../src/store/store";

const b64 = (bytes: number[]): string => Buffer.from(bytes).toString("base64");
const ascii = (text: string): number[] => [...new TextEncoder().encode(text)];
const statusOnly = (status: string): number[] => [0x0a, status.length + 2, 0x0a, status.length, ...ascii(status)];
const preloaded = (inner: number[]): number[] => [0x5a, inner.length, ...inner];
const CUSTOM = [0x12, 0x04, 0x0a, 0x02, ...ascii("hi")];

function setup(opts: { status?: OwnStatus; fail?: boolean; response?: unknown } = {}) {
  const store = createStore({ ...emptyState(), me: { id: "100000000000000010", username: "user1" } });
  store.dispatch({ type: "settings/set", patch: { status: opts.status ?? "online" } });
  const requests: { method: string; path: string; body: unknown }[] = [];
  const rest: RestClient = {
    closed: false,
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      requests.push({ method, path, body });
      if (opts.fail) throw new HttpError(500, "boom");
      return (opts.response ?? {}) as T;
    },
  };
  const ops: unknown[] = [];
  const gateway = { send: (op: number, d: unknown) => ops.push({ op, d }) };
  let presenceChanges = 0;
  let clock = 1_000_000;
  const presence = { statusChanged: () => void (presenceChanges += 1) };
  const sync = createStatusSync({ store, rest, presence, now: () => clock });
  const actions = createActions({ store, rest, gateway, presence, statusSync: sync });
  return {
    store,
    rest,
    requests,
    sync,
    actions,
    presenceChanges: () => presenceChanges,
    advance: (ms: number) => void (clock += ms),
  };
}

const syncNotice = (store: { getState(): { notices: Record<string, { key: string; level: string; text: string }> } }) =>
  Object.values(store.getState().notices).find((n) => n.key === "status-sync");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("setStatus PATCHes settings-proto/1 with the base64 partial protobuf, keeping the rest of StatusSettings", async () => {
  const s = setup();
  s.sync.ready({ user_settings_proto: b64(preloaded([...statusOnly("online"), ...CUSTOM])) });
  s.actions.setStatus!("dnd");
  expect(s.store.getState().settings.status).toBe("dnd");
  expect(s.presenceChanges()).toBe(1);
  await flush();
  expect(s.requests).toEqual([
    { method: "PATCH", path: "/users/@me/settings-proto/1", body: { settings: b64(preloaded([...statusOnly("dnd"), ...CUSTOM])) } },
  ]);
  expect(Object.keys(s.store.getState().notices)).toEqual([]);
});

test("READY without user_settings_proto uses defaults: the PATCH carries only status", async () => {
  const s = setup();
  s.sync.ready({});
  s.actions.setStatus!("idle");
  await flush();
  expect(s.requests[0]?.body).toEqual({ settings: encodeStatusPatch("idle") });
});

test("a failed PATCH keeps the local status and pushes a warn notice", async () => {
  const s = setup({ fail: true });
  s.sync.ready({});
  s.actions.setStatus!("invisible");
  await flush();
  expect(s.requests).toHaveLength(1);
  expect(s.store.getState().settings.status).toBe("invisible");
  expect(s.presenceChanges()).toBe(1);
  const notice = syncNotice(s.store);
  expect(notice).toMatchObject({ level: "warn", text: STATUS_SYNC_NOTICE });
});

test("without a readable StatusSettings it does not PATCH (it would wipe the custom status) and warns", async () => {
  const s = setup();
  s.sync.ready({ user_settings_proto: "!!garbage!!" });
  s.actions.setStatus!("dnd");
  await flush();
  expect(s.requests).toEqual([]);
  expect(s.store.getState().settings.status).toBe("dnd");
  expect(syncNotice(s.store)?.text).toBe(STATUS_SYNC_NOTICE);
});

test("READY adopts the account status when it differs from the saved one", () => {
  const s = setup({ status: "online" });
  s.sync.ready({ user_settings_proto: b64(preloaded(statusOnly("dnd"))) });
  expect(s.store.getState().settings.status).toBe("dnd");
  expect(s.presenceChanges()).toBe(1);
  expect(s.requests).toEqual([]);
});

test("READY with the same status, no status or garbage changes nothing", () => {
  for (const proto of [b64(preloaded(statusOnly("idle"))), b64(preloaded(statusOnly("unknown"))), b64([0x0a, 0x02, 0x08, 0x05]), "%%%", b64([0x5a, 0x40])]) {
    const s = setup({ status: "idle" });
    s.sync.ready({ user_settings_proto: proto });
    expect(s.store.getState().settings.status).toBe("idle");
    expect(s.presenceChanges()).toBe(0);
  }
  const s = setup({ status: "idle" });
  s.sync.ready(null);
  expect(s.store.getState().settings.status).toBe("idle");
});

test("USER_SETTINGS_PROTO_UPDATE from another device updates the status", () => {
  const s = setup({ status: "online" });
  s.sync.ready({});
  s.sync.update({ settings: { type: 1, proto: b64(preloaded(statusOnly("idle"))) }, partial: false });
  expect(s.store.getState().settings.status).toBe("idle");
  expect(s.presenceChanges()).toBe(1);
  // Otro tipo de settings (frecency) se ignora.
  s.sync.update({ settings: { type: 2, proto: b64(preloaded(statusOnly("dnd"))) }, partial: false });
  expect(s.store.getState().settings.status).toBe("idle");
  // Basura no rompe ni cambia nada.
  s.sync.update({ settings: { type: 1, proto: "@@" }, partial: true });
  s.sync.update(undefined);
  s.sync.update({ settings: null });
  expect(s.store.getState().settings.status).toBe("idle");
  expect(s.requests).toEqual([]);
});

test("a partial update merges with the cached StatusSettings, so the next PATCH keeps the custom status", async () => {
  const s = setup({ status: "online" });
  s.sync.ready({ user_settings_proto: b64(preloaded([...statusOnly("online"), ...CUSTOM])) });
  s.sync.update({ settings: { type: 1, proto: b64(preloaded(statusOnly("dnd"))) }, partial: true });
  expect(s.store.getState().settings.status).toBe("dnd");
  // Un parcial sin `status` no toca el estado.
  s.sync.update({ settings: { type: 1, proto: b64([0x0a, 0x02, 0x08, 0x05]) }, partial: true });
  expect(s.store.getState().settings.status).toBe("dnd");
  s.actions.setStatus!("online");
  await flush();
  expect(s.requests[0]?.body).toEqual({ settings: b64(preloaded([...statusOnly("online"), ...CUSTOM])) });
});

test("right after our own PATCH a stale echo is not adopted; later updates are", async () => {
  const s = setup({ status: "online" });
  s.sync.ready({});
  s.actions.setStatus!("dnd");
  s.actions.setStatus!("idle");
  // Eco del primer PATCH mientras todavía hay uno en vuelo.
  s.sync.update({ settings: { type: 1, proto: encodeStatusPatch("dnd") }, partial: true });
  expect(s.store.getState().settings.status).toBe("idle");
  await flush();
  expect(s.requests).toHaveLength(2);
  s.sync.update({ settings: { type: 1, proto: encodeStatusPatch("dnd") }, partial: true });
  expect(s.store.getState().settings.status).toBe("idle");
  s.advance(ECHO_GRACE_MS);
  s.sync.update({ settings: { type: 1, proto: encodeStatusPatch("invisible") }, partial: true });
  expect(s.store.getState().settings.status).toBe("invisible");
});
