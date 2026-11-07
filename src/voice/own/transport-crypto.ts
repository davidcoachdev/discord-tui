import { createCipheriv, createDecipheriv } from "node:crypto";

import { parseRtp } from "./rtp";

const AUTH_TAG_LENGTH = 16;
const NONCE_LENGTH = 4;

function nonceFor(counter: number): Buffer {
  const nonce = Buffer.alloc(12);
  nonce.writeUInt32BE(counter >>> 0, 0);
  return nonce;
}

/** AAD de `aead_aes256_gcm_rtpsize`: header RTP + CSRC + preámbulo de 4 bytes de la extensión. */
function additionalData(packet: Uint8Array, headerLen: number, hasExtension: boolean): Buffer {
  const length = headerLen + (hasExtension ? 4 : 0);
  return Buffer.from(packet.subarray(0, length));
}

/** Bytes del cuerpo de extensión (el preámbulo declara la longitud en palabras de 4 bytes). */
function extensionBodyBytes(packet: Uint8Array, headerLen: number): number {
  const preambleOffset = headerLen;
  if (packet.length < preambleOffset + 4) return 0;
  const words = new DataView(packet.buffer, packet.byteOffset + preambleOffset + 2, 2).getUint16(0, false);
  return words * 4;
}

/**
 * `header | ciphertext | tag(16) | counter(4, BE)`.
 * El contador se agrega al final del paquete y además arma el nonce del AES-GCM.
 */
export function encryptRtpsize(header: Uint8Array, opus: Uint8Array, key: Uint8Array, counter: number): Uint8Array {
  const parsed = parseRtp(header);
  const aad = additionalData(header, parsed.headerLen, parsed.hasExtension);
  const cipher = createCipheriv("aes-256-gcm", key, nonceFor(counter));
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(opus), cipher.final(), cipher.getAuthTag()]);

  const counterBytes = Buffer.alloc(NONCE_LENGTH);
  counterBytes.writeUInt32BE(counter >>> 0, 0);

  return new Uint8Array(Buffer.concat([Buffer.from(header), encrypted, counterBytes]));
}

/**
 * Invierte `encryptRtpsize`. Devuelve `null` si el paquete fue manipulado, la clave no es la
 * correcta o el paquete no tiene el tamaño mínimo.
 */
export function decryptRtpsize(packet: Uint8Array, key: Uint8Array): Uint8Array | null {
  if (packet.length < 12 + AUTH_TAG_LENGTH + NONCE_LENGTH) return null;

  const parsed = parseRtp(packet);
  // Si hay extensión, el ciphertext empieza después del preámbulo de 4 bytes (va en claro, como AAD).
  const headerLen = parsed.headerLen + (parsed.hasExtension ? 4 : 0);
  if (packet.length < headerLen + AUTH_TAG_LENGTH + NONCE_LENGTH) return null;

  const aad = additionalData(packet, parsed.headerLen, parsed.hasExtension);
  const counterOffset = packet.length - NONCE_LENGTH;
  const authTagOffset = counterOffset - AUTH_TAG_LENGTH;

  const counter = new DataView(packet.buffer, packet.byteOffset + counterOffset, NONCE_LENGTH).getUint32(0, false);
  const encrypted = Buffer.from(packet.subarray(headerLen, authTagOffset));
  const authTag = Buffer.from(packet.subarray(authTagOffset, counterOffset));

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonceFor(counter));
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    if (!parsed.hasExtension) return new Uint8Array(plaintext);
    // Con extensión, el cuerpo del header extension viaja dentro del plaintext: se saca.
    const skip = extensionBodyBytes(packet, parsed.headerLen);
    return new Uint8Array(plaintext.subarray(Math.min(skip, plaintext.length)));
  } catch {
    return null;
  }
}
