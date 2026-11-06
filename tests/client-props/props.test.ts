import { expect, test } from "bun:test";

import { createClientProps } from "../../src/client-props/props";

test("browser_user_agent matches the User-Agent header", () => {
  const p = createClientProps({ buildNumber: 400000 });
  expect(p.superProperties().browser_user_agent).toBe(p.headers()["User-Agent"]!);
  expect(p.superProperties()).toMatchObject({
    os: "Linux",
    browser: "Chrome",
    release_channel: "stable",
    client_build_number: 400000,
  });
});

test("heartbeat session id rotates after 30 minutes", () => {
  let now = 0;
  const p = createClientProps({ buildNumber: 1, now: () => now });
  const a = p.superProperties().client_heartbeat_session_id;
  now = 29 * 60_000;
  expect(p.superProperties().client_heartbeat_session_id).toBe(a);
  now = 30 * 60_000 + 1;
  expect(p.superProperties().client_heartbeat_session_id).not.toBe(a);
});
