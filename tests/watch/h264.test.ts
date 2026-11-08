import { expect, test } from "bun:test";

import { H264Depacketizer, assembleAccessUnit, hasIdr, parseRtp, splitAnnexB, type RtpPacket } from "../../src/watch/h264";

function rtp(opts: { seq: number; ts: number; marker?: boolean; pt?: number; ssrc?: number; payload: Uint8Array; ext?: boolean; pad?: number }): Uint8Array {
  const ext = opts.ext ? new Uint8Array([0xbe, 0xde, 0, 1, 0x10, 0xaa, 0, 0]) : new Uint8Array(0);
  const pad = opts.pad ?? 0;
  const buf = new Uint8Array(12 + ext.length + opts.payload.length + pad);
  buf[0] = 0x80 | (opts.ext ? 0x10 : 0) | (pad ? 0x20 : 0);
  buf[1] = (opts.marker ? 0x80 : 0) | (opts.pt ?? 101);
  const v = new DataView(buf.buffer);
  v.setUint16(2, opts.seq & 0xffff);
  v.setUint32(4, opts.ts);
  v.setUint32(8, opts.ssrc ?? 1001);
  buf.set(ext, 12);
  buf.set(opts.payload, 12 + ext.length);
  if (pad) buf[buf.length - 1] = pad;
  return buf;
}
const pkt = (o: Parameters<typeof rtp>[0]): RtpPacket => parseRtp(rtp(o))!;

const SPS = new Uint8Array([0x67, 0x42, 0x00, 0x1f]);
const PPS = new Uint8Array([0x68, 0xce, 0x3c, 0x80]);
const IDR = new Uint8Array([0x65, ...new Array(10).fill(7)]);
const P = new Uint8Array([0x41, 1, 2, 3]);
const sc = [0, 0, 0, 1];

test("parseRtp reads header fields, skips extension and padding, and ignores RTCP", () => {
  const p = parseRtp(rtp({ seq: 65535, ts: 123456, marker: true, payload: P, ext: true, pad: 3 }))!;
  expect(p).toMatchObject({ marker: true, payloadType: 101, sequence: 65535, timestamp: 123456, ssrc: 1001 });
  expect([...p.payload]).toEqual([...P]);
  const rtcp = new Uint8Array(12);
  rtcp[0] = 0x80;
  rtcp[1] = 200; // SR
  expect(parseRtp(rtcp)).toBeNull();
  expect(parseRtp(new Uint8Array(4))).toBeNull();
});

test("splitAnnexB handles 3- and 4-byte start codes", () => {
  const data = new Uint8Array([0, 0, 0, 1, ...SPS, 0, 0, 1, ...PPS, 0, 0, 0, 1, ...P]);
  expect(splitAnnexB(data).map((n) => [...n])).toEqual([[...SPS], [...PPS], [...P]]);
});

test("assembleAccessUnit rebuilds single NALs, STAP-A and FU-A with 4-byte start codes", () => {
  const stap = new Uint8Array([0x78, 0, SPS.length, ...SPS, 0, PPS.length, ...PPS]);
  const fuStart = new Uint8Array([0x7c, 0x80 | 5, ...IDR.subarray(1, 6)]);
  const fuEnd = new Uint8Array([0x7c, 0x40 | 5, ...IDR.subarray(6)]);
  const au = assembleAccessUnit([stap, fuStart, fuEnd])!;
  expect([...au]).toEqual([...sc, ...SPS, ...sc, ...PPS, ...sc, ...IDR]);
  expect(hasIdr(au)).toBe(true);
  expect(assembleAccessUnit([fuStart])).toBeNull(); // FU-A sin final
  expect(assembleAccessUnit([fuEnd])).toBeNull(); // FU-A sin comienzo
});

test("depacketizer waits for the first keyframe, then emits frames in order (reordered packets too)", () => {
  let losses = 0;
  const d = new H264Depacketizer(() => losses++);
  expect(d.push(pkt({ seq: 10, ts: 0, marker: true, payload: P }))).toEqual([]); // P antes de un IDR: se descarta
  const fuA = new Uint8Array([0x7c, 0x80 | 5, ...IDR.subarray(1, 6)]);
  const fuB = new Uint8Array([0x7c, 0x40 | 5, ...IDR.subarray(6)]);
  expect(d.push(pkt({ seq: 12, ts: 3000, marker: true, payload: fuB }))).toEqual([]); // llega antes que su comienzo
  const out = d.push(pkt({ seq: 11, ts: 3000, payload: fuA }));
  expect(out).toHaveLength(1);
  expect(hasIdr(out[0]!)).toBe(true);
  const next = d.push(pkt({ seq: 13, ts: 6000, marker: true, payload: P }));
  expect([...next[0]!]).toEqual([...sc, ...P]);
  expect(losses).toBe(0);
});

test("a lost packet drops the frame, asks for a keyframe once, and resumes on the next IDR", () => {
  let losses = 0;
  const d = new H264Depacketizer(() => losses++);
  d.push(pkt({ seq: 1, ts: 0, marker: true, payload: IDR }));
  // seq 2 (cuadro ts 3000) se pierde; el cuadro siguiente completo lo da por perdido
  expect(d.push(pkt({ seq: 3, ts: 3000, marker: true, payload: P }))).toEqual([]);
  expect(d.push(pkt({ seq: 4, ts: 6000, marker: true, payload: P }))).toEqual([]);
  expect(losses).toBe(1);
  expect(d.dropped).toBeGreaterThan(0);
  const out = d.push(pkt({ seq: 5, ts: 9000, marker: true, payload: IDR }));
  expect(out).toHaveLength(1);
  expect(d.push(pkt({ seq: 6, ts: 12000, marker: true, payload: P }))).toHaveLength(1);
});

test("sequence numbers wrap around 65535", () => {
  const d = new H264Depacketizer();
  expect(d.push(pkt({ seq: 65535, ts: 0, marker: true, payload: IDR }))).toHaveLength(1);
  expect(d.push(pkt({ seq: 0, ts: 3000, marker: true, payload: P }))).toHaveLength(1);
  expect(d.push(pkt({ seq: 65535, ts: 0, marker: true, payload: IDR }))).toEqual([]); // duplicado viejo
});
