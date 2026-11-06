import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "discord-tui-session-config-"));
process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "discord-tui-session-state-"));

const { configDir, sessionPath } = await import("../../src/config/paths");
const { deleteSession, loadSession, saveSession, SessionPermissionError } = await import("../../src/auth/session");
const { Secret } = await import("../../src/secret");
const { fakeToken } = await import("../helpers/fake-token");

test("saveSession creates file 0600 and dir 0700 from the start", async () => {
  await saveSession({ token: new Secret(fakeToken()), userId: "1", buildNumber: 400000 });
  expect(statSync(sessionPath()).mode & 0o777).toBe(0o600);
  expect(statSync(configDir()).mode & 0o777).toBe(0o700);
});

test("loadSession round-trips and returns a Secret", async () => {
  const s = await loadSession();
  expect(s!.token).toBeInstanceOf(Secret);
  expect(s!.token.reveal()).toBe(fakeToken());
  expect(s!.userId).toBe("1");
  expect(s!.buildNumber).toBe(400000);
});

test("loadSession refuses a file that is not 0600", async () => {
  chmodSync(sessionPath(), 0o644);
  await expect(loadSession()).rejects.toBeInstanceOf(SessionPermissionError);
});

test("missing, corrupt or wrong-version session returns null without echoing content", async () => {
  rmSync(sessionPath());
  expect(await loadSession()).toBeNull();
  writeFileSync(sessionPath(), "{no json", { mode: 0o600 });
  expect(await loadSession()).toBeNull();
  writeFileSync(sessionPath(), JSON.stringify({ version: 2, token: fakeToken() }), { mode: 0o600 });
  expect(await loadSession()).toBeNull();
});

test("deleteSession removes the file", async () => {
  rmSync(sessionPath(), { force: true });
  await saveSession({ token: new Secret(fakeToken()), userId: "1", buildNumber: null });
  expect(await deleteSession()).toBe(true);
  expect(existsSync(sessionPath())).toBe(false);
  expect(await deleteSession()).toBe(false);
});
