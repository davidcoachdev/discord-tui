const REQUEST_SIZE = 74;
const ADDRESS_SIZE = 64;

export function buildIpDiscoveryRequest(ssrc: number): Uint8Array {
  const buffer = new Uint8Array(REQUEST_SIZE);
  const view = new DataView(buffer.buffer);
  view.setUint16(0, 0x0001, false);
  view.setUint16(2, 70, false);
  view.setUint32(4, ssrc >>> 0, false);
  // Los 64 bytes de la dirección y el puerto (bytes 8..73) van en cero.
  return buffer;
}

export function parseIpDiscoveryResponse(buffer: Uint8Array): { ip: string; port: number } {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const type = view.getUint16(0, false);
  if (type !== 0x0002) throw new Error(`respuesta de IP discovery inesperada (type ${type})`);

  const raw = buffer.subarray(8, 8 + ADDRESS_SIZE);
  const end = raw.indexOf(0);
  const ip = Buffer.from(end === -1 ? raw : raw.subarray(0, end)).toString("utf8");
  const port = view.getUint16(72, false);
  return { ip, port };
}
