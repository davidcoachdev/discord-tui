import { describe, expect, test } from "bun:test";

import { buildRtpHeader, parseRtp } from "../../../src/voice/own/rtp";

describe("RTP header", () => {
  test("builds the exact 12 bytes", () => {
    const header = buildRtpHeader({ seq: 1, timestamp: 960, ssrc: 0x01020304 });
    expect([...header]).toEqual([0x80, 0x78, 0, 1, 0, 0, 3, 0xc0, 1, 2, 3, 4]);
  });

  test("round-trips through parseRtp", () => {
    const header = buildRtpHeader({ seq: 65535, timestamp: 1234567, ssrc: 0xdeadbeef });
    const parsed = parseRtp(header);
    expect(parsed.seq).toBe(65535);
    expect(parsed.timestamp).toBe(1234567);
    expect(parsed.ssrc).toBe(0xdeadbeef >>> 0);
    expect(parsed.headerLen).toBe(12);
    expect(parsed.hasExtension).toBe(false);
  });

  test("detects the extension bit", () => {
    const header = buildRtpHeader({ seq: 1, timestamp: 1, ssrc: 1 });
    header[0] = (header[0]! | 0x10) as number;
    const parsed = parseRtp(header);
    expect(parsed.hasExtension).toBe(true);
  });
});
