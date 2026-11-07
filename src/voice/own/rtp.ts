export interface RtpHeaderFields {
  seq: number;
  timestamp: number;
  ssrc: number;
}

export interface ParsedRtp extends RtpHeaderFields {
  headerLen: number;
  hasExtension: boolean;
}

const RTP_VERSION_BYTE = 0x80;
const RTP_PAYLOAD_TYPE = 0x78; // 120

export function buildRtpHeader(h: RtpHeaderFields): Uint8Array {
  const header = new Uint8Array(12);
  const view = new DataView(header.buffer);
  header[0] = RTP_VERSION_BYTE;
  header[1] = RTP_PAYLOAD_TYPE;
  view.setUint16(2, h.seq & 0xffff, false);
  view.setUint32(4, h.timestamp >>> 0, false);
  view.setUint32(8, h.ssrc >>> 0, false);
  return header;
}

export function parseRtp(packet: Uint8Array): ParsedRtp {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const first = packet[0] ?? 0;
  const hasExtension = (first & 0x10) !== 0;
  const csrcCount = first & 0x0f;
  const headerLen = 12 + csrcCount * 4;
  return {
    seq: view.getUint16(2, false),
    timestamp: view.getUint32(4, false),
    ssrc: view.getUint32(8, false),
    headerLen,
    hasExtension,
  };
}
