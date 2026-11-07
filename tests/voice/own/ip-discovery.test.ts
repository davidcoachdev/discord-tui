import { describe, expect, test } from "bun:test";

import { buildIpDiscoveryRequest, parseIpDiscoveryResponse } from "../../../src/voice/own/ip-discovery";

describe("IP discovery", () => {
  test("request is 74 bytes with type 1 and length 70", () => {
    const b = buildIpDiscoveryRequest(42);
    expect(b.length).toBe(74);
    expect([...b.slice(0, 8)]).toEqual([0, 1, 0, 70, 0, 0, 0, 42]);
  });

  test("request body is all zero after the ssrc and ends with port 0", () => {
    const b = buildIpDiscoveryRequest(1);
    expect([...b.slice(8, 72)].every((byte) => byte === 0)).toBe(true);
    expect([...b.slice(72, 74)]).toEqual([0, 0]);
  });

  test("response parses ip and port", () => {
    const response = new Uint8Array(74);
    const view = new DataView(response.buffer);
    view.setUint16(0, 2);
    view.setUint16(2, 70);
    view.setUint32(4, 42);
    const ip = "203.0.113.5";
    for (let i = 0; i < ip.length; i += 1) response[8 + i] = ip.charCodeAt(i);
    view.setUint16(72, 50123);

    const parsed = parseIpDiscoveryResponse(response);
    expect(parsed.ip).toBe(ip);
    expect(parsed.port).toBe(50123);
  });
});
