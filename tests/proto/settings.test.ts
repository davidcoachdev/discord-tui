import { expect, test } from "bun:test";

import {
  decodeBase64,
  decodeSettingsStatus,
  encodeStatusPatch,
  parseFields,
  readStatus,
  readStatusSettings,
} from "../../src/proto/settings";
import { OWN_STATUSES } from "../../src/settings/settings";

const ascii = (text: string): number[] => [...new TextEncoder().encode(text)];
const b64 = (bytes: number[]): string => Buffer.from(bytes).toString("base64");

/** StatusSettings con solo `status` (campo 1, StringValue{ value = 1 }). */
const statusOnly = (status: string): number[] => {
  const value = ascii(status);
  return [0x0a, value.length + 2, 0x0a, value.length, ...value];
};

/** PreloadedUserSettings { status (11) = StatusSettings }: tag 11<<3|2 = 0x5a. */
const preloaded = (statusSettings: number[]): number[] => [0x5a, statusSettings.length, ...statusSettings];

test("encodes a partial PreloadedUserSettings with only status, byte for byte", () => {
  expect([...Buffer.from(encodeStatusPatch("dnd"), "base64")]).toEqual([0x5a, 0x07, 0x0a, 0x05, 0x0a, 0x03, 0x64, 0x6e, 0x64]);
  expect(encodeStatusPatch("dnd")).toBe("WgcKBQoDZG5k");
  expect([...Buffer.from(encodeStatusPatch("invisible"), "base64")]).toEqual([0x5a, 0x0d, 0x0a, 0x0b, 0x0a, 0x09, ...ascii("invisible")]);
});

test("round trip for every status", () => {
  for (const status of OWN_STATUSES) expect(decodeSettingsStatus(encodeStatusPatch(status))).toBe(status);
});

test("the patch keeps the other StatusSettings fields, replaces status and drops the expiry", () => {
  const customStatus = [0x12, 0x04, 0x0a, 0x02, ...ascii("hi")]; // 2: CustomStatus { text = "hi" }
  const showGame = [0x1a, 0x02, 0x08, 0x01]; // 3: BoolValue { value = true }
  const expires = [0x21, 1, 2, 3, 4, 5, 6, 7, 8]; // 4: fixed64
  const created = [0x2a, 0x02, 0x08, 0x07]; // 5: UInt64Value { value = 7 }
  const base = new Uint8Array([...statusOnly("idle"), ...customStatus, ...showGame, ...expires, ...created]);
  const patch = [...Buffer.from(encodeStatusPatch("dnd", base), "base64")];
  const inner = [...statusOnly("dnd"), ...customStatus, ...showGame, ...created];
  expect(patch).toEqual(preloaded(inner));
});

test("decodes status from a full blob, skipping unknown fields of every wire type", () => {
  const blob = [
    0x0a, 0x02, 0x08, 0x05, // 1 versions { client_version = 5 }
    0x98, 0x06, 0x96, 0x01, // 99 varint 150
    0xf5, 0x01, 1, 2, 3, 4, // 30 fixed32
    0xf9, 0x01, 1, 2, 3, 4, 5, 6, 7, 8, // 31 fixed64
    ...preloaded([0x1a, 0x02, 0x08, 0x00, ...statusOnly("idle")]),
    0x62, 0x03, 0x0a, 0x01, 0x78, // 12 localization
  ];
  expect(decodeSettingsStatus(b64(blob))).toBe("idle");
  expect(parseFields(new Uint8Array(blob))?.map((f) => [f.field, f.wire])).toEqual([[1, 2], [99, 0], [30, 5], [31, 1], [11, 2], [12, 2]]);
});

test("repeated status submessages merge, the last status wins", () => {
  const blob = [...preloaded(statusOnly("dnd")), ...preloaded([0x1a, 0x02, 0x08, 0x01]), ...preloaded(statusOnly("idle"))];
  expect(decodeSettingsStatus(b64(blob))).toBe("idle");
  const merged = readStatusSettings(new Uint8Array(blob));
  expect(merged?.length).toBe(7 + 4 + 8);
});

test("no status, unknown status values and garbage give null without throwing", () => {
  expect(decodeSettingsStatus("")).toBeNull();
  expect(decodeSettingsStatus(b64([0x0a, 0x02, 0x08, 0x05]))).toBeNull();
  expect(decodeSettingsStatus(b64(preloaded(statusOnly("unknown"))))).toBeNull();
  expect(decodeSettingsStatus(b64(preloaded(statusOnly("streaming"))))).toBeNull();
  expect(decodeSettingsStatus(b64(preloaded([0x0a, 0x00])))).toBeNull(); // StringValue vacío
  const garbage: unknown[] = [
    null,
    undefined,
    42,
    { settings: "x" },
    "!!!not base64!!!",
    "A",
    b64([0x5a, 0x10, 0x0a]), // largo que se pasa del buffer
    b64([0x5a]), // tag sin largo
    b64([0x80, 0x80]), // varint cortado
    b64([0x00, 0x01]), // campo 0
    b64([0x0b, 0x0c]), // wire type 3 (grupo)
    b64([0x0e]), // wire type 6
    b64([0x09, 1, 2, 3]), // fixed64 cortado
    b64([0x0d, 1, 2]), // fixed32 cortado
    b64(preloaded([0x0a, 0x05, 0x0a, 0x03, 0xff, 0xfe, 0xfd])), // UTF-8 inválido
    b64(preloaded([0x0a, 0x03, 0x0a, 0x09, 0x00])), // StringValue roto adentro
    b64(preloaded([0xff, 0xff])), // StatusSettings roto
    b64([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]), // varint de 11 bytes
  ];
  for (const input of garbage) expect(decodeSettingsStatus(input)).toBeNull();
  for (let seed = 1; seed < 300; seed += 1) {
    const bytes = Array.from({ length: seed % 40 }, (_, i) => (seed * 131 + i * 977) % 256);
    expect(() => decodeSettingsStatus(b64(bytes))).not.toThrow();
  }
});

test("a broken StatusSettings is reported as null, an absent one as empty", () => {
  expect(readStatusSettings(new Uint8Array(preloaded([0xff, 0xff])))).toBeNull();
  expect(readStatusSettings(new Uint8Array([0x0a, 0x02, 0x08, 0x05]))?.length).toBe(0);
  expect(readStatus(new Uint8Array())).toBeNull();
  expect(decodeBase64("WgcKBQoDZG5k")).toEqual(new Uint8Array([0x5a, 0x07, 0x0a, 0x05, 0x0a, 0x03, 0x64, 0x6e, 0x64]));
});
