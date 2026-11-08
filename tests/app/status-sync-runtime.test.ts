import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "discord-tui-status-sync-state-"));
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "discord-tui-status-sync-config-"));

import { createRuntime } from "../../src/app/runtime";
import { createClientProps } from "../../src/client-props/props";
import { encodeStatusPatch } from "../../src/proto/settings";
import { Secret } from "../../src/secret";
import { DEFAULT_SETTINGS, type OwnStatus } from "../../src/settings/settings";
import { startFakeGateway, type FakeGateway } from "../fakes/fake-gateway";
import { fakeToken } from "../helpers/fake-token";

const readyBase = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "fixtures", "gateway", "READY-1.json"), "utf8"),
);

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timeout");
    await Bun.sleep(5);
  }
}

const immediateTimer = ((fn: () => void) => {
  fn();
  return 0;
}) as unknown as typeof setTimeout;

function setup(status: OwnStatus, readyExtra: Record<string, unknown>) {
  let fake: FakeGateway;
  fake = startFakeGateway({
    onIdentify: () => fake.dispatch("READY", { ...readyBase.d, ...readyExtra, resume_gateway_url: fake.url }),
  });
  const patches: { url: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "PATCH") patches.push({ url: String(url), body: JSON.parse(init.body ?? "null") });
    return Response.json([]);
  }) as unknown as typeof fetch;
  const runtime = createRuntime({
    session: { token: new Secret(fakeToken()), userId: "100000000000000010", buildNumber: 663810 },
    me: { id: "100000000000000010", username: "user1" },
    props: createClientProps({ buildNumber: 663810 }),
    url: fake.url,
    fetch: fetchImpl,
    setTimer: immediateTimer,
    random: () => 0.5,
    initialSettings: { ...DEFAULT_SETTINGS, status, idleAfterMinutes: null },
    settingsPath: join(mkdtempSync(join(tmpdir(), "discord-tui-status-sync-settings-")), "settings.json"),
  });
  const op3 = () => fake.received.filter((p) => p.op === 3).map((p) => p.d);
  return { fake, runtime, op3, patches };
}

test("READY's user_settings_proto wins over the saved status, and op 3 aligns this session", async () => {
  const { fake, runtime, op3, patches } = setup("online", { user_settings_proto: encodeStatusPatch("dnd") });
  try {
    runtime.start();
    await waitFor(() => runtime.store.getState().settings.status === "dnd");
    await waitFor(() => op3().length === 1);
    expect(op3()[0]).toEqual({ status: "dnd", since: 0, activities: [], afk: false });
    expect(patches).toEqual([]);
  } finally {
    await runtime.stop();
    fake.stop();
  }
});

test("USER_SETTINGS_PROTO_UPDATE from the phone changes the chip; choosing a status PATCHes settings-proto", async () => {
  const { fake, runtime, op3, patches } = setup("online", {});
  try {
    runtime.start();
    await waitFor(() => runtime.store.getState().connection === "ready");
    fake.dispatch("USER_SETTINGS_PROTO_UPDATE", { settings: { type: 1, proto: encodeStatusPatch("idle") }, partial: true });
    await waitFor(() => runtime.store.getState().settings.status === "idle");
    await waitFor(() => op3().length === 1);
    expect(op3()[0]).toMatchObject({ status: "idle" });
    expect(patches).toEqual([]);

    runtime.actions.setStatus!("invisible");
    await waitFor(() => patches.length === 1);
    expect(patches[0]!.url.endsWith("/users/@me/settings-proto/1")).toBe(true);
    expect(patches[0]!.body).toEqual({ settings: encodeStatusPatch("invisible") });
    await waitFor(() => op3().length === 2);
    expect(op3()[1]).toMatchObject({ status: "invisible" });
  } finally {
    await runtime.stop();
    fake.stop();
  }
});
