import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "discord-tui-resume-state-"));
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "discord-tui-resume-config-"));

import { createClientProps } from "../../src/client-props/props";
import { createGateway, type GatewayDeps } from "../../src/gateway/connection";
import { Secret } from "../../src/secret";
import { startFakeGateway, type FakeGateway } from "../fakes/fake-gateway";
import { fakeToken } from "../helpers/fake-token";

const readyBase = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "fixtures", "gateway", "READY-1.json"), "utf8"),
);

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
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

function gatewayFor(fake: FakeGateway, extra: Partial<GatewayDeps> = {}) {
  return createGateway({
    token: new Secret(fakeToken()),
    props: createClientProps({ buildNumber: 663810 }),
    url: fake.url,
    setTimer: immediateTimer,
    random: () => 0.5,
    ...extra,
  });
}

function readyFor(fake: FakeGateway) {
  return { ...readyBase, d: { ...readyBase.d, resume_gateway_url: fake.url } };
}

test("op 7 resumes against resume_gateway_url with session_id and seq", async () => {
  let fake: FakeGateway;
  let ready = null as ReturnType<typeof readyFor> | null;
  fake = startFakeGateway({ onIdentify: () => fake.dispatch("READY", ready!.d) });
  ready = readyFor(fake);

  const gw = gatewayFor(fake);
  const sessions: string[] = [];
  gw.on("session", (kind) => sessions.push(kind));
  gw.connect();
  try {
    await waitFor(() => gw.status === "ready");
    fake.sendRaw({ op: 7 });
    await waitFor(() => fake.received.some((message) => message.op === 6));

    const resume = fake.received.find((message) => message.op === 6)!;
    expect(resume.d.session_id).toBe("SESSION_ID");
    expect(resume.d.seq).toBe(1);

    fake.dispatch("RESUMED", {});
    await waitFor(() => gw.status === "ready");
    expect(sessions).toContain("resumed");
  } finally {
    gw.close();
    fake.stop();
  }
});

test("missing heartbeat ack closes and resumes", async () => {
  let fake: FakeGateway;
  let ready = null as ReturnType<typeof readyFor> | null;
  fake = startFakeGateway({
    heartbeatInterval: 50,
    noHeartbeatAck: true,
    onIdentify: () => fake.dispatch("READY", ready!.d),
  });
  ready = readyFor(fake);

  const gw = gatewayFor(fake);
  gw.connect();
  try {
    await waitFor(() => fake.received.some((message) => message.op === 6), 3000);
  } finally {
    gw.close();
    fake.stop();
  }
});

test("op 9 false waits and re-identifies, emitting session identified", async () => {
  let fake: FakeGateway;
  let ready = null as ReturnType<typeof readyFor> | null;
  fake = startFakeGateway({ onIdentify: () => fake.dispatch("READY", ready!.d) });
  ready = readyFor(fake);

  const gw = gatewayFor(fake, { random: () => 0.5 });
  const sessions: string[] = [];
  gw.on("session", (kind) => sessions.push(kind));
  gw.connect();
  try {
    await waitFor(() => gw.status === "ready");
    fake.sendRaw({ op: 9, d: false });
    await waitFor(() => fake.received.filter((message) => message.op === 2).length === 2);
    expect(sessions.filter((kind) => kind === "identified")).toHaveLength(2);
  } finally {
    gw.close();
    fake.stop();
  }
});

test("4007 re-identifies", async () => {
  let fake: FakeGateway;
  let ready = null as ReturnType<typeof readyFor> | null;
  fake = startFakeGateway({ onIdentify: () => fake.dispatch("READY", ready!.d) });
  ready = readyFor(fake);

  const gw = gatewayFor(fake);
  gw.connect();
  try {
    await waitFor(() => gw.status === "ready");
    fake.close(4007);
    await waitFor(() => fake.received.filter((message) => message.op === 2).length === 2);
    expect(fake.received.filter((message) => message.op === 6)).toHaveLength(0);
  } finally {
    gw.close();
    fake.stop();
  }
});

test("backoff grows and caps at 30 s", async () => {
  const fake = startFakeGateway({ closeOnOpen: 4000 });
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const gw = createGateway({
    token: new Secret(fakeToken()),
    props: createClientProps({ buildNumber: 1 }),
    url: fake.url,
    random: () => 0.5,
    setTimer: ((fn: () => void, ms?: number) => {
      timers.push({ fn, ms: ms ?? 0 });
      return 0;
    }) as unknown as typeof setTimeout,
  });

  gw.connect();
  try {
    await waitFor(() => timers.length >= 1);
    const delays: number[] = [];
    for (let index = 0; index < 7; index += 1) {
      delays.push(timers[index]!.ms);
      if (index < 6) {
        timers[index]!.fn();
        await waitFor(() => timers.length > index + 1);
      }
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  } finally {
    gw.close();
    fake.stop();
  }
});

test("status goes ready, reconnecting, resuming and ready again", async () => {
  let fake: FakeGateway;
  let ready = null as ReturnType<typeof readyFor> | null;
  fake = startFakeGateway({ onIdentify: () => fake.dispatch("READY", ready!.d) });
  ready = readyFor(fake);

  const gw = gatewayFor(fake);
  const statuses: string[] = [];
  gw.on("status", (next) => statuses.push(next));
  gw.connect();
  try {
    await waitFor(() => gw.status === "ready");
    fake.sendRaw({ op: 7 });
    await waitFor(() => fake.received.some((message) => message.op === 6));
    fake.dispatch("RESUMED", {});
    await waitFor(() => gw.status === "ready");

    expect(statuses).toContain("reconnecting");
    expect(statuses).toContain("resuming");
    expect(statuses.at(-1)).toBe("ready");
  } finally {
    gw.close();
    fake.stop();
  }
});

test("op 9 opens exactly one new socket (two sockets would share zlib state and corrupt it)", async () => {
  let fake: FakeGateway;
  let ready = null as ReturnType<typeof readyFor> | null;
  fake = startFakeGateway({ onIdentify: () => fake.dispatch("READY", ready!.d) });
  ready = readyFor(fake);
  // Timers reales, como en la app: el cierre del socket viejo llega antes de que venza la espera del op 9.
  const gw = gatewayFor(fake, { setTimer: setTimeout, random: () => 0 });
  const statuses: string[] = [];
  gw.on("status", (s) => statuses.push(s));
  gw.connect();
  try {
    await waitFor(() => gw.status === "ready");
    fake.sendRaw({ op: 9, d: false });
    await waitFor(() => fake.received.filter((message) => message.op === 2).length === 2, 6000);
    await Bun.sleep(2500);
    expect(fake.received.filter((message) => message.op === 2)).toHaveLength(2);
    expect(statuses.filter((s) => s === "connecting")).toHaveLength(2);
    // Un mensaje después de la reconexión se sigue descomprimiendo bien.
    fake.dispatch("MESSAGE_CREATE", { id: "1", channel_id: "2", content: "ok" });
    const got: string[] = [];
    gw.on("dispatch", (t) => got.push(t));
    fake.dispatch("TYPING_START", { channel_id: "2", user_id: "3" });
    await waitFor(() => got.includes("TYPING_START"));
    expect(gw.status).toBe("ready");
  } finally {
    gw.close();
    fake.stop();
  }
}, 15_000);
