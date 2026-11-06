import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "discord-tui-gw-"));
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "discord-tui-gw-config-"));

import { createClientProps } from "../../src/client-props/props";
import { logPath } from "../../src/config/paths";
import { createGateway, type GatewayDeps } from "../../src/gateway/connection";
import { GATEWAY_CAPABILITIES } from "../../src/gateway/identify";
import { findTokenLike } from "../../src/security/token-pattern";
import { Secret } from "../../src/secret";
import { startFakeGateway, type FakeGateway } from "../fakes/fake-gateway";
import { fakeToken } from "../helpers/fake-token";

const ready = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "fixtures", "gateway", "READY-1.json"), "utf8"),
);

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timeout");
    await Bun.sleep(5);
  }
}

function gatewayFor(fake: FakeGateway, extra: Partial<GatewayDeps> = {}) {
  return createGateway({
    token: new Secret(fakeToken()),
    props: createClientProps({ buildNumber: 663810 }),
    url: fake.url,
    ...extra,
  });
}

test("sends identify after hello, without intents", async () => {
  const fake = startFakeGateway({});
  const gw = gatewayFor(fake);
  gw.connect();
  try {
    await waitFor(() => fake.received.some((message) => message.op === 2));
    const identify = fake.received.find((message) => message.op === 2)!;
    expect(identify.d.intents).toBeUndefined();
    expect(identify.d.capabilities).toBe(GATEWAY_CAPABILITIES);
    expect(identify.d.compress).toBe(false);
  } finally {
    gw.close();
    fake.stop();
  }
});

test("first heartbeat after interval*jitter, then every interval, with the last seq", async () => {
  const fake = startFakeGateway({ heartbeatInterval: 100, onIdentify: () => fake.dispatch("READY", ready.d) });
  const gw = gatewayFor(fake, { random: () => 0.5 });
  gw.connect();
  try {
    await waitFor(() => gw.status === "ready");
    await waitFor(() => fake.received.filter((message) => message.op === 1).length >= 2, 1500);
    const beats = fake.received.filter((message) => message.op === 1);
    expect(beats.at(-1)!.d).toBe(1);
  } finally {
    gw.close();
    fake.stop();
  }
});

test("answers op 1 from the server immediately", async () => {
  const fake = startFakeGateway({ heartbeatInterval: 60_000, onIdentify: () => fake.dispatch("READY", ready.d) });
  const gw = gatewayFor(fake);
  gw.connect();
  try {
    await waitFor(() => gw.status === "ready");
    const before = fake.received.filter((message) => message.op === 1).length;
    fake.sendRaw({ op: 1 });
    await waitFor(() => fake.received.filter((message) => message.op === 1).length > before);
  } finally {
    gw.close();
    fake.stop();
  }
});

test("emits dispatch, updates seq and stores session_id and resume url from READY", async () => {
  const fake = startFakeGateway({ onIdentify: () => fake.dispatch("READY", ready.d) });
  const gw = gatewayFor(fake);
  const dispatched: string[] = [];
  gw.on("dispatch", (t) => dispatched.push(t));
  gw.connect();
  try {
    await waitFor(() => gw.status === "ready");
    expect(gw.sessionId).toBe("SESSION_ID");
    expect(gw.seq).toBe(1);
    expect(gw.resumeGatewayUrl).toBe("wss://gateway-us-east1-b.discord.gg");

    fake.dispatch("MESSAGE_CREATE", { id: "1" });
    await waitFor(() => dispatched.includes("MESSAGE_CREATE"));
    expect(gw.seq).toBe(2);
  } finally {
    gw.close();
    fake.stop();
  }
});

test("close 4004 emits fatal unauthorized and does not reconnect", async () => {
  const fake = startFakeGateway({ onIdentify: () => fake.dispatch("READY", ready.d) });
  const gw = gatewayFor(fake);
  let fatal: string | null = null;
  gw.on("fatal", (reason) => {
    fatal = reason;
  });
  gw.connect();
  try {
    await waitFor(() => gw.status === "ready");
    fake.close(4004);
    await waitFor(() => fatal !== null);
    expect(fatal as string | null).toBe("unauthorized");
    expect(gw.status).toBe("disconnected");
    await Bun.sleep(100);
    expect(fake.received.filter((message) => message.op === 2)).toHaveLength(1);
  } finally {
    gw.close();
    fake.stop();
  }
});

test("never logs the identify payload", async () => {
  const fake = startFakeGateway({ onIdentify: () => fake.dispatch("READY", ready.d) });
  const gw = gatewayFor(fake);
  gw.connect();
  try {
    await waitFor(() => gw.status === "ready");
  } finally {
    gw.close();
    fake.stop();
  }
  const logFile = readFileSync(logPath(), "utf8");
  expect(findTokenLike(logFile)).toEqual([]);
  expect(logFile).not.toContain(fakeToken());
});

test("send throttles to 110 payloads per 60 s", () => {
  class StubWebSocket {
    static instances: StubWebSocket[] = [];
    sent: string[] = [];
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(public url: string) {
      StubWebSocket.instances.push(this);
    }

    send(data: string): void {
      this.sent.push(data);
    }

    close(): void {
      // noop
    }
  }

  const timers: Array<() => void> = [];
  const gw = createGateway({
    token: new Secret(fakeToken()),
    props: createClientProps({ buildNumber: 1 }),
    WebSocketImpl: StubWebSocket as unknown as typeof WebSocket,
    setTimer: ((fn: () => void) => {
      timers.push(fn);
      return 0;
    }) as unknown as typeof setTimeout,
  });

  gw.connect();
  const ws = StubWebSocket.instances[0]!;
  ws.onmessage!({ data: JSON.stringify({ op: 10, d: { heartbeat_interval: 60_000 } }) });

  for (let index = 0; index < 109; index += 1) gw.send(3, { index });
  const sentOps = () => ws.sent.map((raw) => JSON.parse(raw).op).filter((op) => op === 3).length;
  expect(sentOps()).toBe(109);

  gw.send(3, { last: true });
  expect(timers).toHaveLength(1);
  timers[0]!();
  expect(sentOps()).toBe(110);
});
