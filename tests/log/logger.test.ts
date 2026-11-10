import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "discord-tui-state-"));
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "discord-tui-config-"));

const { createLogger, log } = await import("../../src/log/logger");
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

test("rotates the log file when it exceeds the size limit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discord-tui-log-rotate-"));
  const file = join(dir, "app.log");
  const logger = createLogger({ file, maxBytes: 128 });
  logger.info("big-first", { msg: "x".repeat(200) });
  logger.info("small-second", { state: "two" });
  await logger.flush();
  const rotated = readFileSync(`${file}.1`, "utf8");
  expect(rotated).toContain("big-first");
  expect(readFileSync(file, "utf8")).toContain("small-second");
  expect(readFileSync(file, "utf8")).not.toContain("big-first");
});

test("rotates an already oversized file on the first write", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discord-tui-log-rotate-"));
  const file = join(dir, "app.log");
  writeFileSync(file, "x".repeat(300));
  const logger = createLogger({ file, maxBytes: 128 });
  logger.info("after-restart", { state: "ok" });
  await logger.flush();
  expect(readFileSync(`${file}.1`, "utf8")).toBe("x".repeat(300));
  expect(readFileSync(file, "utf8")).toContain("after-restart");
});
