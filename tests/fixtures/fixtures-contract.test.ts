import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CHROME_UA, createClientProps } from "../../src/client-props/props";
import { buildIdentify, GATEWAY_CAPABILITIES } from "../../src/gateway/identify";
import { Secret } from "../../src/secret";
import { findTokenLike } from "../../src/security/token-pattern";
import { fakeToken } from "../helpers/fake-token";
import { shapeOf } from "../helpers/shape";

const fixturesDir = join(import.meta.dir, "..", "..", "fixtures");

const REQUIRED = [
  "browser/identify.json",
  "browser/op37.json",
  "browser/op4-join.json",
  "browser/send-message.json",
  "browser/ack.json",
  "browser/messages-page.json",
  "gateway/READY-1.json",
  "gateway/READY-versioned-1.json",
  "gateway/MESSAGE_CREATE-1.json",
  "gateway/GUILD_MEMBER_LIST_UPDATE-1.json",
  "gateway/VOICE_STATE_UPDATE-1.json",
  "gateway/VOICE_SERVER_UPDATE-1.json",
];

function load(rel: string): any {
  return JSON.parse(readFileSync(join(fixturesDir, rel), "utf8"));
}

function walk(value: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      visit(key, child);
      walk(child, visit);
    }
  }
}

test.each(REQUIRED)("fixture %s exists, parses and has redacted secret keys", (file) => {
  const raw = readFileSync(join(fixturesDir, file), "utf8");
  expect(findTokenLike(raw)).toEqual([]);

  const parsed = JSON.parse(raw);
  walk(parsed, (key, value) => {
    if (["authorization", "cookie", "encrypted_token", "ticket"].includes(key)) {
      expect(value).toBe("[redacted]");
    }
    if (key === "token") expect(["[redacted]", null]).toContain(value as string | null);
    if (key === "session_id") expect(value).toBe("SESSION_ID");
    if (key === "user_settings_proto") expect(value).toBe("[redacted]");
  });
});

test("buildIdentify has the same keys as the browser identify, the same capabilities and no intents", () => {
  const browserIdentify = load("browser/identify.json");
  const props = createClientProps({ buildNumber: browserIdentify.d.properties.client_build_number });
  const ours = buildIdentify(new Secret(fakeToken()), props);

  expect(Object.keys(ours.d).sort()).toEqual(Object.keys(browserIdentify.d).sort());
  expect(ours.d.capabilities).toBe(browserIdentify.d.capabilities);
  expect(ours.d.capabilities).toBe(GATEWAY_CAPABILITIES);
  expect(ours.d).not.toHaveProperty("intents");
});

test("our super properties have the same keys as the captured ones", () => {
  const browserIdentify = load("browser/identify.json");
  const props = createClientProps({ buildNumber: 1 });
  expect(Object.keys(props.superProperties()).sort()).toEqual(Object.keys(browserIdentify.d.properties).sort());
});

test("CHROME_UA matches the captured user-agent", () => {
  const send = load("browser/send-message.json");
  expect(CHROME_UA).toBe(send.headers["user-agent"]);
});

test("shapeOf summarizes nested shapes for fixture comparisons", () => {
  expect(shapeOf({ b: 1, a: ["x"], c: { d: true }, e: null })).toEqual({
    a: ["string"],
    b: "number",
    c: { d: "boolean" },
    e: "null",
  });
});
