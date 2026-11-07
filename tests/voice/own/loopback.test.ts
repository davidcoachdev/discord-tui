import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";

import { buildRtpHeader, parseRtp } from "../../../src/voice/own/rtp";
import { decryptRtpsize, encryptRtpsize } from "../../../src/voice/own/transport-crypto";

describe("encryptRtpsize / decryptRtpsize", () => {
  test("round-trips a packet", () => {
    const key = randomBytes(32);
    const header = buildRtpHeader({ seq: 1, timestamp: 960, ssrc: 1 });
    const opus = new Uint8Array([1, 2, 3, 4, 5]);
    const packet = encryptRtpsize(header, opus, key, 1);
    const decrypted = decryptRtpsize(packet, key);
    expect(decrypted && [...decrypted]).toEqual([...opus]);
  });

  test("tampered byte returns null", () => {
    const key = randomBytes(32);
    const header = buildRtpHeader({ seq: 1, timestamp: 960, ssrc: 1 });
    const packet = encryptRtpsize(header, new Uint8Array([9, 9, 9]), key, 1);
    packet[packet.length - 6] = (packet[packet.length - 6]! ^ 0xff) as number;
    expect(decryptRtpsize(packet, key)).toBeNull();
  });

  test("wrong key returns null", () => {
    const key = randomBytes(32);
    const otherKey = randomBytes(32);
    const header = buildRtpHeader({ seq: 1, timestamp: 960, ssrc: 1 });
    const packet = encryptRtpsize(header, new Uint8Array([9, 9, 9]), key, 1);
    expect(decryptRtpsize(packet, otherKey)).toBeNull();
  });

  test("strips an RTP header extension body", () => {
    const key = randomBytes(32);
    const base = buildRtpHeader({ seq: 1, timestamp: 960, ssrc: 1 });
    // header RTP (12) + preámbulo de extensión (4: profile u16 + largo en palabras u16)
    const header = new Uint8Array(16);
    header.set(base);
    header[0] = (header[0]! | 0x10) as number; // marca de extensión
    new DataView(header.buffer).setUint16(12, 0xbede, false);
    new DataView(header.buffer).setUint16(14, 1, false); // 1 palabra = 4 bytes de cuerpo

    const extensionBody = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
    const opus = new Uint8Array([7, 8, 9]);
    const payload = new Uint8Array([...extensionBody, ...opus]);

    const packet = encryptRtpsize(header, payload, key, 2);
    const decrypted = decryptRtpsize(packet, key);
    expect(decrypted && [...decrypted]).toEqual([...opus]);
  });

  test("50 packets over a 127.0.0.1 UDP loopback arrive decrypted and in order", async () => {
    const key = randomBytes(32);
    const received: Array<{ seq: number; opus: Uint8Array }> = [];

    const server = await Bun.udpSocket({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(_socket, buf) {
          const parsed = parseRtp(buf);
          const decrypted = decryptRtpsize(buf, key);
          if (decrypted) received.push({ seq: parsed.seq, opus: decrypted });
        },
      },
    });

    const client = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });

    const port = server.port;
    for (let i = 0; i < 50; i += 1) {
      const header = buildRtpHeader({ seq: i, timestamp: i * 960, ssrc: 0xabc });
      const opus = new Uint8Array([i % 256]);
      const packet = encryptRtpsize(header, opus, key, i + 1);
      client.send(packet, port, "127.0.0.1");
    }

    const deadline = Date.now() + 2000;
    while (received.length < 50 && Date.now() < deadline) {
      await Bun.sleep(10);
    }

    received.sort((a, b) => a.seq - b.seq);
    expect(received.map((p) => p.seq)).toEqual([...Array(50).keys()]);

    client.close();
    server.close();
  });
});
