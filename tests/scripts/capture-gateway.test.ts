import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startFakeGateway, type FakeGateway } from "../fakes/fake-gateway";
import { fakeToken } from "../helpers/fake-token";

const repoRoot = join(import.meta.dir, "../..");

test("capture script identifies without intents and saves dispatches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discord-tui-capture-"));
  const configDir = join(dir, "config", "discord-tui");
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(configDir, "session.json"),
    JSON.stringify({ version: 1, token: fakeToken(), user_id: "1", client_build_number: 663810 }),
    { mode: 0o600 },
  );

  const out = join(dir, "out");
  let fake: FakeGateway;
  fake = startFakeGateway({
    onIdentify: () =>
      fake.dispatch("READY", { user: { id: "111111111111111111", username: "gonfake" }, guilds: [] }),
  });

  const proc = Bun.spawn(
    ["bun", "scripts/capture-gateway.ts", "--url", fake.url, "--out", out, "--capabilities", "16381"],
    {
      cwd: repoRoot,
      env: { ...process.env, XDG_CONFIG_HOME: join(dir, "config"), XDG_STATE_HOME: join(dir, "state") },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const deadline = Date.now() + 5000;
  while (!existsSync(join(out, "READY-1.json")) && Date.now() < deadline) await Bun.sleep(20);

  proc.stdin.write("q");
  await proc.stdin.flush();
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  fake.stop();

  expect(stderr).toBe("");
  expect(code).toBe(0);
  expect(fake.received[0]).toMatchObject({ op: 2, d: { capabilities: 16381, compress: false } });
  expect(fake.received[0]!.d.intents).toBeUndefined();
  expect(existsSync(join(out, "READY-1.json"))).toBe(true);
  expect(stdout).toContain("READY 1");
  expect(stdout).not.toContain(fakeToken());
});

async function waitUntil(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timeout");
    await Bun.sleep(20);
  }
}

test("o sends the op 37 payload and v joins and leaves voice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discord-tui-capture-"));
  const configDir = join(dir, "config", "discord-tui");
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(configDir, "session.json"),
    JSON.stringify({ version: 1, token: fakeToken(), user_id: "1", client_build_number: 663810 }),
    { mode: 0o600 },
  );
  const op37Path = join(dir, "op37.json");
  writeFileSync(op37Path, JSON.stringify({ op: 37, d: { guild_id: "999", channel_id: "888", typing: true } }));

  let fake: FakeGateway;
  fake = startFakeGateway({});

  const proc = Bun.spawn(
    [
      "bun",
      "scripts/capture-gateway.ts",
      "--url",
      fake.url,
      "--out",
      join(dir, "out"),
      "--capabilities",
      "16381",
      "--op37",
      op37Path,
      "--voice",
      "111",
      "222",
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, XDG_CONFIG_HOME: join(dir, "config"), XDG_STATE_HOME: join(dir, "state") },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  await waitUntil(() => fake.received.some((message) => message.op === 2));
  proc.stdin.write("o");
  proc.stdin.write("v");
  await proc.stdin.flush();

  await waitUntil(() => fake.received.some((message) => message.op === 37 && message.d?.guild_id === "999"));
  await waitUntil(() => fake.received.some((message) => message.op === 4 && message.d?.channel_id === "222"));

  fake.dispatch("VOICE_SERVER_UPDATE", { guild_id: "111", channel_id: "222", endpoint: "x", token: "y" });
  await waitUntil(() => fake.received.some((message) => message.op === 4 && message.d?.channel_id === null));

  proc.stdin.write("q");
  await proc.stdin.flush();
  expect(await proc.exited).toBe(0);
  fake.stop();
});
