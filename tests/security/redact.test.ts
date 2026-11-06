import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRedactor } from "../../src/security/redact";
import { fakeToken } from "../helpers/fake-token";

const repoRoot = join(import.meta.dir, "../..");

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "discord-tui-redact-"));
}

function runCli(args: string[]) {
  return Bun.spawn(["bun", "scripts/redact.ts", ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
}

test("secret keys are redacted at any depth", () => {
  const r = createRedactor();
  expect(r.redactJson({ d: { token: fakeToken(), properties: { os: "Linux" } } })).toEqual({
    d: { token: "[redacted]", properties: { os: "Linux" } },
  });
});

test("snowflakes map to ordered fake ids consistently, also inside strings", () => {
  const r = createRedactor();
  const out = r.redactJson({
    a: "222222222222222222",
    b: "<@111111111111111111>",
    c: "https://cdn.discordapp.com/attachments/222222222222222222/x.png?ex=1&hm=2",
  }) as Record<string, string>;
  expect(out).toEqual({
    a: "100000000000000002",
    b: "<@100000000000000001>",
    c: "https://cdn.discordapp.com/attachments/100000000000000002/x.png",
  });
});

test("X-Super-Properties is decoded, redacted and re-encoded", () => {
  const properties = {
    os: "Linux",
    client_launch_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    client_heartbeat_session_id: "9c858901-8a57-4791-81fe-4c455b099bc9",
  };
  const curl = [
    "curl 'https://discord.com/api/v9/users/@me' \\",
    `  -H 'authorization: ${fakeToken()}' \\`,
    "  -H 'cookie: __dcfduid=abc' \\",
    `  -H 'x-super-properties: ${Buffer.from(JSON.stringify(properties)).toString("base64")}'`,
  ].join("\n");

  const out = createRedactor().redactCurl(curl);
  const decoded = JSON.parse(atob(out.headers["x-super-properties"]!)) as Record<string, string>;
  expect(decoded.client_launch_id).toMatch(/^00000000-0000-4000-8000-/);
  expect(decoded.os).toBe("Linux");
  expect(out.headers.authorization).toBe("[redacted]");
  expect(out.headers.cookie).toBe("[redacted]");
});

test("cli exits 2 and writes nothing if a token-like string survives", async () => {
  const root = tempDir();
  const out = join(tempDir(), "out");
  writeFileSync(join(root, "bad.json"), JSON.stringify({ foo: fakeToken() }));

  const proc = runCli(["--root", root, "--out", out]);
  expect(await proc.exited).toBe(2);
  expect(existsSync(join(out, "bad.json"))).toBe(false);
});

test("cli trims READY arrays, converts curl to json and prints ok per file", async () => {
  const root = tempDir();
  const out = join(tempDir(), "out");
  mkdirSync(join(root, "gateway"), { recursive: true });
  mkdirSync(join(root, "browser"), { recursive: true });

  const guilds = Array.from({ length: 5 }, (_, index) => ({
    id: String(100000000000000000n + BigInt(index)),
    name: `guild-${index}`,
  }));
  writeFileSync(
    join(root, "gateway", "READY-1.json"),
    JSON.stringify({ op: 0, t: "READY", s: 1, d: { guilds, relationships: [{ id: "111111111111111111" }] } }),
  );
  writeFileSync(
    join(root, "browser", "send-message.curl.txt"),
    "curl 'https://discord.com/api/v9/channels/222222222222222222/messages' -H 'authorization: " +
      fakeToken() +
      "' --data-raw '{\"content\":\"hola\"}'",
  );

  const proc = runCli(["--root", root, "--out", out, "--trim", "3"]);
  const stdout = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  expect(stdout).toContain("ok gateway/READY-1.json");
  expect(stdout).toContain("ok browser/send-message.json");

  const ready = JSON.parse(readFileSync(join(out, "gateway", "READY-1.json"), "utf8"));
  expect(ready.d.guilds).toHaveLength(3);
  expect(ready.d.relationships).toEqual([]);

  const request = JSON.parse(readFileSync(join(out, "browser", "send-message.json"), "utf8"));
  expect(request.headers.authorization).toBe("[redacted]");
  expect(request.url).toContain("10000000000000000");
  expect(request.body.content).toBe("hola");
});
