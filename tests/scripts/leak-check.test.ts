import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { leakCheck } from "../../scripts/leak-check";
import { fakeToken } from "../helpers/fake-token";

const repoRoot = join(import.meta.dir, "../..");

function tempSession(): { dir: string; sessionFile: string } {
  const dir = mkdtempSync(join(tmpdir(), "discord-tui-leak-"));
  const configDir = join(dir, "config", "discord-tui");
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const sessionFile = join(configDir, "session.json");
  writeFileSync(
    sessionFile,
    JSON.stringify({ version: 1, token: fakeToken(), user_id: "1", client_build_number: null }),
    { mode: 0o600 },
  );
  return { dir, sessionFile };
}

test("reports matches by file without printing the token", async () => {
  const { dir, sessionFile } = tempSession();
  const stateDir = join(dir, "state", "discord-tui");
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const leakyPath = join(stateDir, "leaky.log");
  writeFileSync(leakyPath, `Authorization: ${fakeToken()}\n`);
  writeFileSync(join(stateDir, "clean.log"), "nada\n");

  const result = await leakCheck({ sessionFile, scanDirs: [stateDir] });
  expect(result).toMatchObject({ matches: 1, files: [leakyPath], filesScanned: 2 });
});

test("CLI prints OK and does not echo the token", async () => {
  const { dir } = tempSession();
  const stateHome = join(dir, "state");
  const stateDir = join(stateHome, "discord-tui");
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(stateDir, "discord-tui.log"), '{"event":"ok"}\n');

  const proc = Bun.spawn(["bun", "scripts/leak-check.ts"], {
    cwd: repoRoot,
    env: { ...process.env, XDG_CONFIG_HOME: join(dir, "config"), XDG_STATE_HOME: stateHome },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  expect(stdout).toContain("OK: 0 coincidencias");
  expect(stdout).not.toContain(fakeToken());
});

test("CLI exits 1 and lists only paths when something leaks", async () => {
  const { dir } = tempSession();
  const stateHome = join(dir, "state");
  const stateDir = join(stateHome, "discord-tui");
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const leakyPath = join(stateDir, "leaky.log");
  writeFileSync(leakyPath, `Authorization: ${fakeToken()}\n`);

  const proc = Bun.spawn(["bun", "scripts/leak-check.ts"], {
    cwd: repoRoot,
    env: { ...process.env, XDG_CONFIG_HOME: join(dir, "config"), XDG_STATE_HOME: stateHome },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(1);
  expect(stdout).toContain("FALLA: 1 coincidencias en:");
  expect(stdout).toContain(leakyPath);
  expect(stdout).not.toContain(fakeToken());
});
