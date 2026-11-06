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
