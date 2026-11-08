import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "discord-tui-presence-state-"));
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "discord-tui-presence-config-"));

import { DOCUMENTED_OP3 } from "../../src/actions/presence";
import { createRuntime } from "../../src/app/runtime";
import { createClientProps } from "../../src/client-props/props";
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

function setup(status: OwnStatus) {
  let fake: FakeGateway;
  fake = startFakeGateway({
    onIdentify: () => fake.dispatch("READY", { ...readyBase.d, resume_gateway_url: fake.url }),
  });
  const runtime = createRuntime({
    session: { token: new Secret(fakeToken()), userId: "100000000000000010", buildNumber: 663810 },
    me: { id: "100000000000000010", username: "user1" },
    props: createClientProps({ buildNumber: 663810 }),
    url: fake.url,
    fetch: (async () => Response.json([])) as unknown as typeof fetch,
    setTimer: immediateTimer,
    random: () => 0.5,
    initialSettings: { ...DEFAULT_SETTINGS, status, idleAfterMinutes: null },
    settingsPath: join(mkdtempSync(join(tmpdir(), "discord-tui-presence-settings-")), "settings.json"),
  });
  const identifies = () => fake.received.filter((p) => p.op === 2).map((p) => p.d.presence);
  const op3 = () => fake.received.filter((p) => p.op === 3).map((p) => p.d);
  return { fake, runtime, identifies, op3 };
}

test("identify carries the saved status, and so does the re-identify after a reconnect", async () => {
  const { fake, runtime, identifies, op3 } = setup("dnd");
  try {
    runtime.start();
    await waitFor(() => runtime.store.getState().connection === "ready");
    expect(identifies()).toEqual([{ status: "dnd", since: 0, activities: [], afk: false }]);

    runtime.actions.setStatus!("invisible");
    await waitFor(() => op3().length === 1);
    expect(op3()[0]).toEqual({ status: "invisible", since: 0, activities: [], afk: false });
    expect(Object.keys(op3()[0]).sort()).toEqual(Object.keys(DOCUMENTED_OP3).sort());
    expect(runtime.store.getState().settings.status).toBe("invisible");

    fake.sendRaw({ op: 9, d: false });
    await waitFor(() => identifies().length === 2);
    expect(identifies()[1]).toMatchObject({ status: "invisible", since: 0 });
    await waitFor(() => runtime.store.getState().connection === "ready");
    expect(op3()).toHaveLength(1);
  } finally {
    await runtime.stop();
    fake.stop();
  }
});

test("a status chosen while reconnecting is sent once the session resumes", async () => {
  const { fake, runtime, op3 } = setup("online");
  try {
    runtime.start();
    await waitFor(() => runtime.store.getState().connection === "ready");
    fake.sendRaw({ op: 7 });
    await waitFor(() => fake.received.some((p) => p.op === 6));
    runtime.actions.setStatus!("dnd");
    expect(op3()).toHaveLength(0);
    fake.dispatch("RESUMED", {});
    await waitFor(() => op3().length === 1);
    expect(op3()[0]).toEqual({ status: "dnd", since: 0, activities: [], afk: false });
  } finally {
    await runtime.stop();
    fake.stop();
  }
});
