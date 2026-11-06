import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "discord-tui-state-"));
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "discord-tui-config-"));

const { log } = await import("../../src/log/logger");
const { logPath, stateDir } = await import("../../src/config/paths");
const { findTokenLike } = await import("../../src/security/token-pattern");
const { fakeToken } = await import("../helpers/fake-token");

function logFile(): string {
  return readFileSync(logPath(), "utf8");
}

function lineFor(event: string): string {
  const line = logFile()
    .split("\n")
    .find((candidate) => candidate.includes(`"event":"${event}"`));
  if (!line) throw new Error(`no log line for ${event}`);
  return line;
}

test("logger drops fields that are not allowlisted", async () => {
  log.info("drops-fields", { route: "/users/@me", authorization: "abc" } as any);
  await log.flush();
  const line = lineFor("drops-fields");
  expect(line).toContain('"route":"/users/@me"');
  expect(line).not.toContain("abc");
  expect(line).toContain('"authorization":"[dropped]"');
});

test("logger redacts token-like strings in allowed fields", async () => {
  log.error("boom", { msg: `failed with ${fakeToken()}` });
  await log.flush();
  const fileContents = logFile();
  expect(findTokenLike(fileContents)).toEqual([]);
  expect(fileContents).toContain("[redacted]");
});

test("log file is created with mode 0600 and its dir with 0700", async () => {
  expect(statSync(logPath()).mode & 0o777).toBe(0o600);
  expect(statSync(stateDir()).mode & 0o777).toBe(0o700);
});
