import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "discord-tui-runtime-state-"));
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "discord-tui-runtime-config-"));

import { createRuntime } from "../../src/app/runtime";
import { createClientProps } from "../../src/client-props/props";
import { Secret } from "../../src/secret";
import { selectMessages } from "../../src/store/selectors";
import { startFakeGateway, type FakeGateway } from "../fakes/fake-gateway";
import { fakeToken } from "../helpers/fake-token";

const readyBase = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "fixtures", "gateway", "READY-1.json"), "utf8"),
);
const CHANNEL = "100000000000000002";

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

function readyFor(fake: FakeGateway) {
  return { ...readyBase, d: { ...readyBase.d, resume_gateway_url: fake.url } };
}

function message(id: string, content = "hola") {
  return {
    id,
    channel_id: CHANNEL,
    guild_id: "100000000000000001",
    author: { id: "100000000000000010", username: "user1" },
    content,
    timestamp: "2026-11-06T12:00:00.000000+00:00",
    edited_timestamp: null,
    attachments: [],
    embeds: [],
    mentions: [],
    mention_everyone: false,
    referenced_message: null,
    reactions: [],
  };
}

function runtimeFor(fake: FakeGateway, requests: string[], latest: () => unknown[]) {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.includes(`/channels/${CHANNEL}/messages`)) return Response.json(latest());
    return Response.json({});
  }) as unknown as typeof fetch;

  return createRuntime({
    session: { token: new Secret(fakeToken()), userId: "100000000000000010", buildNumber: 663810 },
    me: { id: "100000000000000010", username: "user1" },
    props: createClientProps({ buildNumber: 663810 }),
    url: fake.url,
    fetch: fetchImpl,
    setTimer: immediateTimer,
    random: () => 0.5,
  });
}

test("after a non-resumed reconnect, the open channel refetches latest and has no duplicates", async () => {
  let fake: FakeGateway;
  let ready = null as ReturnType<typeof readyFor> | null;
  fake = startFakeGateway({ onIdentify: () => fake.dispatch("READY", ready!.d) });
  ready = readyFor(fake);

  const requests: string[] = [];
  let latest: unknown[] = [];
  const runtime = runtimeFor(fake, requests, () => latest);

  try {
    runtime.start();
    await waitFor(() => runtime.store.getState().me !== null);
    await runtime.actions.openChannel(CHANNEL);
    expect(requests).toHaveLength(1);

    const first = message("100000000000000100");
    fake.dispatch("MESSAGE_CREATE", first);
    await waitFor(() => selectMessages(runtime.store.getState(), CHANNEL).length === 1);

    latest = [first, message("100000000000000101", "otro")];
    fake.sendRaw({ op: 9, d: false });

    await waitFor(() => selectMessages(runtime.store.getState(), CHANNEL).length === 2);
    expect(selectMessages(runtime.store.getState(), CHANNEL).map((m) => m.id)).toEqual([
      "100000000000000100",
      "100000000000000101",
    ]);
    expect(requests).toHaveLength(2);
  } finally {
    runtime.stop();
    fake.stop();
  }
});

test("after a resume, nothing is refetched", async () => {
  let fake: FakeGateway;
  let ready = null as ReturnType<typeof readyFor> | null;
  fake = startFakeGateway({ onIdentify: () => fake.dispatch("READY", ready!.d) });
  ready = readyFor(fake);

  const requests: string[] = [];
  const runtime = runtimeFor(fake, requests, () => []);

  try {
    runtime.start();
    await waitFor(() => runtime.store.getState().me !== null);
    await runtime.actions.openChannel(CHANNEL);
    expect(requests).toHaveLength(1);

    fake.sendRaw({ op: 7 });
    await waitFor(() => fake.received.some((notification) => notification.op === 6));
    fake.dispatch("RESUMED", {});
    await waitFor(() => runtime.store.getState().connection === "ready");

    expect(requests).toHaveLength(1);
  } finally {
    runtime.stop();
    fake.stop();
  }
});

test("401 from rest calls onUnauthorized", async () => {
  let fake: FakeGateway;
  let ready = null as ReturnType<typeof readyFor> | null;
  fake = startFakeGateway({ onIdentify: () => fake.dispatch("READY", ready!.d) });
  ready = readyFor(fake);

  const fetchImpl = (async () => Response.json({ code: 40001 }, { status: 401 })) as unknown as typeof fetch;
  const runtime = createRuntime({
    session: { token: new Secret(fakeToken()), userId: "1", buildNumber: 663810 },
    me: { id: "1", username: "user1" },
    props: createClientProps({ buildNumber: 663810 }),
    url: fake.url,
    fetch: fetchImpl,
    setTimer: immediateTimer,
    random: () => 0.5,
  });

  let unauthorized = 0;
  runtime.onUnauthorized(() => {
    unauthorized += 1;
  });

  try {
    runtime.start();
    await waitFor(() => runtime.store.getState().me !== null);
    await runtime.actions.openChannel(CHANNEL).catch(() => {});
    await waitFor(() => unauthorized === 1);
  } finally {
    runtime.stop();
    fake.stop();
  }
});

test("4004 from the gateway calls onUnauthorized", async () => {
  let fake: FakeGateway;
  let ready = null as ReturnType<typeof readyFor> | null;
  fake = startFakeGateway({ onIdentify: () => fake.dispatch("READY", ready!.d) });
  ready = readyFor(fake);

  const runtime = runtimeFor(fake, [], () => []);
  let unauthorized = 0;
  runtime.onUnauthorized(() => {
    unauthorized += 1;
  });

  try {
    runtime.start();
    await waitFor(() => runtime.store.getState().me !== null);
    fake.close(4004);
    await waitFor(() => unauthorized === 1);
  } finally {
    runtime.stop();
    fake.stop();
  }
});

test("runtime.stop leaves voice (op 4 with channel_id null) before closing the gateway", async () => {
  let fake: FakeGateway;
  let ready = null as ReturnType<typeof readyFor> | null;
  fake = startFakeGateway({ onIdentify: () => fake.dispatch("READY", ready!.d) });
  ready = readyFor(fake);
  const order: string[] = [];
  const statusListeners = new Set<(s: any, e?: string) => void>();
  const runtime = createRuntime({
    session: { token: new Secret(fakeToken()), userId: "100000000000000010", buildNumber: 663810 },
    me: { id: "100000000000000010", username: "user1" },
    props: createClientProps({ buildNumber: 663810 }),
    url: fake.url,
    fetch: (async () => Response.json([])) as unknown as typeof fetch,
    setTimer: immediateTimer,
    random: () => 0.5,
    voiceSession: {
      join: async () => statusListeners.forEach((fn) => fn("connected")),
      setFlags() {},
      leave: async () => {
        order.push(`leave (gateway ${runtime.store.getState().connection})`);
        statusListeners.forEach((fn) => fn("idle"));
      },
      onStatus: (fn) => {
        statusListeners.add(fn);
        return () => statusListeners.delete(fn);
      },
      sendOpus() {},
      setSpeaking() {},
      onSpeaking: () => () => {},
      onOpus: () => () => {},
      privacyCode: () => null,
    },
    voiceMedia: {
      startCapture: async () => ({ onFrame: () => () => {}, stop: async () => {} }),
      startPlayback: async () => ({ write() {}, stop: async () => {}, dropped: () => 0 }),
      createCodec: () => ({ encode: (p: Uint8Array) => p, decode: (o: Uint8Array) => o }),
      createVad: () => ({ push: () => null, isOpen: false, thresholdDb: -45, levelDb: -96 }),
    },
  });
  try {
    runtime.start();
    await waitFor(() => runtime.store.getState().connection === "ready");
    runtime.store.dispatch({ type: "voice/joining", guildId: "100000000000000001", channelId: "100000000000000003" });
    await runtime.stop();
    expect(order).toEqual(["leave (gateway ready)"]);
    expect(runtime.store.getState().voice.channelId).toBeNull();
  } finally {
    fake.stop();
  }
});
