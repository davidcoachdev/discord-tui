import { OWN_STATUSES, type OwnStatus } from "../settings/settings";

/*
 * Mínimo de protobuf para el estado propio en PreloadedUserSettings. Números de campo de
 * github.com/discord-userdoccers/discord-protos, discord_protos/discord_users/v1/PreloadedUserSettings.proto
 * (commit 921d792, 2026-11-07), que es la fuente que enlaza docs.discord.food "User Settings (Protobuf)":
 *   PreloadedUserSettings.status = 11          (StatusSettings, length-delimited)
 *   StatusSettings.status = 1                  (google.protobuf.StringValue, length-delimited)
 *   StatusSettings.status_expires_at_ms = 4    (fixed64)
 *   StringValue.value = 1                      (string, length-delimited)
 * Todo lo demás se saltea sin interpretarlo y, al escribir, se copia tal cual.
 */

export const PRELOADED_STATUS_FIELD = 11;
export const STATUS_SETTINGS_STATUS_FIELD = 1;
export const STATUS_SETTINGS_EXPIRES_FIELD = 4;
const STRING_VALUE_FIELD = 1;

const WIRE_VARINT = 0;
const WIRE_I64 = 1;
const WIRE_LEN = 2;
const WIRE_I32 = 5;

export interface ProtoField {
  field: number;
  wire: number;
  /** El campo entero tal como vino (tag incluido), para copiarlo sin tocar. */
  raw: Uint8Array;
  /** Solo wire type 2: el contenido sin tag ni largo. */
  payload: Uint8Array | null;
}

/** Varint en `buf[pos]`: `[valor, siguiente posición]`, o null si se corta o pasa de 2^53. */
function readVarint(buf: Uint8Array, pos: number): [number, number] | null {
  let value = 0;
  let scale = 1;
  for (let i = 0; i < 10; i += 1) {
    const byte = buf[pos + i];
    if (byte === undefined) return null;
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) return value > Number.MAX_SAFE_INTEGER ? null : [value, pos + i + 1];
    scale *= 128;
  }
  return null;
}

/** Los campos de un mensaje en orden. Null si algo no cierra (nunca tira). */
export function parseFields(buf: Uint8Array): ProtoField[] | null {
  const fields: ProtoField[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const start = pos;
    const tag = readVarint(buf, pos);
    if (tag === null) return null;
    const field = Math.floor(tag[0] / 8);
    const wire = tag[0] % 8;
    if (field === 0) return null;
    pos = tag[1];
    let payload: Uint8Array | null = null;
    if (wire === WIRE_VARINT) {
      const value = readVarint(buf, pos);
      if (value === null) return null;
      pos = value[1];
    } else if (wire === WIRE_I64) {
      pos += 8;
    } else if (wire === WIRE_I32) {
      pos += 4;
    } else if (wire === WIRE_LEN) {
      const length = readVarint(buf, pos);
      if (length === null) return null;
      pos = length[1] + length[0];
      if (pos > buf.length) return null;
      payload = buf.subarray(length[1], pos);
    } else {
      // 3/4 (grupos, obsoletos) y 6/7 no existen en estos mensajes.
      return null;
    }
    if (pos > buf.length) return null;
    fields.push({ field, wire, raw: buf.subarray(start, pos), payload });
  }
  return fields;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Las apariciones de un submensaje, concatenadas: en protobuf concatenar es mergear, así que
 * es el valor efectivo. Vacío si no está; null si el mensaje está roto.
 */
function subMessage(buf: Uint8Array, field: number): Uint8Array | null {
  const fields = parseFields(buf);
  if (fields === null) return null;
  return concat(fields.filter((f) => f.field === field && f.payload !== null).map((f) => f.payload as Uint8Array));
}

function encodeVarint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest % 128) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return out;
}

function lengthDelimited(field: number, payload: Uint8Array): Uint8Array {
  return concat([Uint8Array.from([...encodeVarint(field * 8 + WIRE_LEN), ...encodeVarint(payload.length)]), payload]);
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Base64 estándar (con o sin padding). Null si no lo es. */
export function decodeBase64(text: unknown): Uint8Array | null {
  if (typeof text !== "string" || !BASE64.test(text) || text.length % 4 === 1) return null;
  return new Uint8Array(Buffer.from(text, "base64"));
}

export function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** El StatusSettings efectivo de un PreloadedUserSettings (vacío si no está). Null si está roto. */
export function readStatusSettings(settings: Uint8Array): Uint8Array | null {
  const status = subMessage(settings, PRELOADED_STATUS_FIELD);
  if (status === null || parseFields(status) === null) return null;
  return status;
}

/** El estado de un StatusSettings, si es uno de los que elegimos acá ("unknown" y el resto → null). */
export function readStatus(statusSettings: Uint8Array): OwnStatus | null {
  const wrapper = subMessage(statusSettings, STATUS_SETTINGS_STATUS_FIELD);
  if (wrapper === null) return null;
  const fields = parseFields(wrapper);
  const value = fields?.filter((f) => f.field === STRING_VALUE_FIELD && f.payload !== null).at(-1)?.payload;
  if (!value) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    return null;
  }
  return OWN_STATUSES.includes(text as OwnStatus) ? (text as OwnStatus) : null;
}

/** Atajo: el estado de un blob base64 completo, o null si no hay o no se entiende. */
export function decodeSettingsStatus(base64: unknown): OwnStatus | null {
  const bytes = decodeBase64(base64);
  const status = bytes === null ? null : readStatusSettings(bytes);
  return status === null ? null : readStatus(status);
}

/**
 * PreloadedUserSettings parcial con solo el campo `status`, en base64, para el PATCH. La doc dice
 * que un campo de primer nivel se manda entero (lo que falte vuelve al default), así que se parte
 * del StatusSettings conocido (`base`) y se reemplaza solo `status`; se saca también el vencimiento
 * (`status_expires_at_ms`), porque el estado elegido acá no vence. El resto se copia byte a byte.
 */
export function encodeStatusPatch(status: OwnStatus, base: Uint8Array = new Uint8Array()): string {
  const kept = (parseFields(base) ?? []).filter(
    (f) => f.field !== STATUS_SETTINGS_STATUS_FIELD && f.field !== STATUS_SETTINGS_EXPIRES_FIELD,
  );
  const stringValue = lengthDelimited(STRING_VALUE_FIELD, new TextEncoder().encode(status));
  const statusSettings = concat([lengthDelimited(STATUS_SETTINGS_STATUS_FIELD, stringValue), ...kept.map((f) => f.raw)]);
  return encodeBase64(lengthDelimited(PRELOADED_STATUS_FIELD, statusSettings));
}
