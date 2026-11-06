import { createHash } from "node:crypto";

export interface RaKeys {
  publicSpkiB64: string;
  fingerprint: string;
  decrypt(b64: string): Promise<Uint8Array>;
}

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fingerprintOf(spkiDer: Uint8Array): string {
  return toBase64Url(createHash("sha256").update(spkiDer).digest());
}

export async function generateRaKeys(): Promise<RaKeys> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    false,
    ["decrypt", "encrypt"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return {
    publicSpkiB64: Buffer.from(spki).toString("base64"),
    fingerprint: fingerprintOf(spki),
    async decrypt(b64: string): Promise<Uint8Array> {
      const cipher = Buffer.from(b64, "base64");
      const plain = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, pair.privateKey, cipher);
      return new Uint8Array(plain);
    },
  };
}
