import { expect, test } from "bun:test";

import { createVoiceStats } from "../../src/voice/stats";
import { formatPrivacyCode } from "../../src/voice/privacy-code";

test("stats log only allowlisted fields every 60 s", () => {
  const logged: { event: string; fields: unknown }[] = [];
  let tick: (() => void) | null = null;
  let every = 0;
  const stats = createVoiceStats({
    log: { info: (event, fields) => void logged.push({ event, fields }) },
    read: () => ({ packets: 120, decodeErrors: 2, state: "connected" }),
    setTimer: (fn, ms) => ((tick = fn), (every = ms), 1),
    clearTimer: () => (tick = null),
  });
  expect(every).toBe(60_000);
  tick!();
  expect(logged).toEqual([{ event: "voice.stats", fields: { packets: 120, decode_errors: 2, state: "connected" } }]);
  stats.stop();
  expect(tick).toBeNull();
});

test("privacy code is grouped by 5 digits", () => {
  expect(formatPrivacyCode("123451234512")).toBe("12345 12345 12");
});
