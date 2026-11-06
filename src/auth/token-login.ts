import { findTokenLike } from "../security/token-pattern";
import { Secret } from "../secret";
import type { Http } from "../rest/http";

export type NormalizeResult =
  | { ok: true; token: Secret }
  | { ok: false; reason: "empty" | "prefixed" | "shape" };

function stripQuotes(value: string): string {
  const starts = value.startsWith('"') || value.startsWith("'");
  const ends = value.endsWith('"') || value.endsWith("'");
  if (starts && ends && value.length >= 2) return value.slice(1, -1).trim();
  return value;
}

export function normalizePastedToken(raw: string): NormalizeResult {
  const value = stripQuotes(raw.trim());
  if (value.length === 0) return { ok: false, reason: "empty" };
  if (/^(bearer|bot)\s+/i.test(value)) return { ok: false, reason: "prefixed" };
  if (!findTokenLike(value).includes(value)) return { ok: false, reason: "shape" };
  return { ok: true, token: new Secret(value) };
}

export async function validateToken(
  token: Secret,
  http: Http,
): Promise<{ userId: string; username: string }> {
  // El token ya viaja en el Http (header Authorization); se recibe acá por contrato.
  void token;
  const me = await http.request<{ id?: string; username?: string }>("GET", "/users/@me");
  if (typeof me?.id !== "string" || typeof me.username !== "string") {
    throw new Error("invalid user response");
  }
  return { userId: me.id, username: me.username };
}
