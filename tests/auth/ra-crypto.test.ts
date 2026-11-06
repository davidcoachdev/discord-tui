import { expect, test } from "bun:test";

import { fingerprintOf, generateRaKeys } from "../../src/auth/ra-crypto";

test("fingerprintOf is sha256 base64url without padding", () => {
  expect(fingerprintOf(new Uint8Array([1, 2, 3]))).toBe("A5BYxvLAy0ksUzsKTRTvd8wPeKvMztUofYShogEc-4E");
});

test("decrypt reverses RSA-OAEP SHA-256 encryption with the exported public key", async () => {
  const k = await generateRaKeys();
  const publicKey = await crypto.subtle.importKey(
    "spki",
    Buffer.from(k.publicSpkiB64, "base64"),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const cipher = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, new TextEncoder().encode("hola"));
  expect(new TextDecoder().decode(await k.decrypt(Buffer.from(cipher).toString("base64")))).toBe("hola");
});

test("fingerprint matches the exported key", async () => {
  const k = await generateRaKeys();
  expect(k.fingerprint).toBe(fingerprintOf(Buffer.from(k.publicSpkiB64, "base64")));
});
