const SECRET_KEYS = new Set([
  "token",
  "auth_token",
  "authorization",
  "cookie",
  "x-fingerprint",
  "ticket",
  "encrypted_token",
  "email",
  "phone",
  "password",
  "analytics_token",
  "user_settings_proto",
  "x-captcha-key",
]);

const USER_NAME_KEYS = new Set(["username", "global_name", "nick"]);
const HASH_KEYS = new Set(["avatar", "icon", "banner"]);

const SNOWFLAKE_RE = /\b\d{17,20}\b/g;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const IPV4_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const HASH_RE = /^(a_)?([0-9a-f]{32})$/i;
const SIGNED_QUERY_RE = /[?&](ex|is|hm)=/;

export interface RedactedCurl {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface Redactor {
  redactJson(value: unknown): unknown;
  redactCurl(curlText: string): RedactedCurl;
}

function isSnowflakeText(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}

export function createRedactor(): Redactor {
  const snowflakes = new Map<string, string>();
  let snowflakeSeq = 0;
  const uuids = new Map<string, string>();
  let uuidSeq = 0;
  const users = new Map<string, string>();
  let userSeq = 0;
  const names = new Map<string, string>();
  let nameSeq = 0;

  function fakeSnowflake(value: string): string {
    const known = snowflakes.get(value);
    if (known !== undefined) return known;
    snowflakeSeq += 1;
    const fake = String(100000000000000000n + BigInt(snowflakeSeq));
    snowflakes.set(value, fake);
    return fake;
  }

  function fakeUuid(value: string): string {
    const known = uuids.get(value.toLowerCase());
    if (known !== undefined) return known;
    uuidSeq += 1;
    const fake = `00000000-0000-4000-8000-${String(uuidSeq).padStart(12, "0")}`;
    uuids.set(value.toLowerCase(), fake);
    return fake;
  }

  function fakeUser(value: string): string {
    const known = users.get(value);
    if (known !== undefined) return known;
    userSeq += 1;
    const fake = `user${userSeq}`;
    users.set(value, fake);
    return fake;
  }

  function fakeName(value: string): string {
    const known = names.get(value);
    if (known !== undefined) return known;
    nameSeq += 1;
    const fake = `name${nameSeq}`;
    names.set(value, fake);
    return fake;
  }

  function collectSnowflakes(value: unknown, out: Set<string>): void {
    if (typeof value === "string") {
      for (const match of value.matchAll(SNOWFLAKE_RE)) out.add(match[0]);
      return;
    }
    if (typeof value === "number") {
      if (Number.isInteger(value) && isSnowflakeText(String(value))) out.add(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectSnowflakes(item, out);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const item of Object.values(value)) collectSnowflakes(item, out);
    }
  }

  function assignSnowflakes(value: unknown): void {
    const found = new Set<string>();
    collectSnowflakes(value, found);
    const fresh = [...found].filter((id) => !snowflakes.has(id)).sort((a, b) => a.length - b.length || a.localeCompare(b));
    for (const id of fresh) fakeSnowflake(id);
  }

  function redactString(value: string): string {
    let out = value;
    if (SIGNED_QUERY_RE.test(out)) out = out.split("?")[0]!;
    out = out.replace(UUID_RE, (match) => fakeUuid(match));
    out = out.replace(IPV4_RE, "203.0.113.1");
    out = out.replace(SNOWFLAKE_RE, (match) => fakeSnowflake(match));
    return out;
  }

  function redactHash(value: string): string {
    const match = value.match(HASH_RE);
    if (match) return `${match[1] ?? ""}${"0".repeat(32)}`;
    return redactString(value);
  }

  function transform(value: unknown, key: string | null): unknown {
    if (key !== null) {
      if (SECRET_KEYS.has(key)) return "[redacted]";
      if (key === "session_id") return "SESSION_ID";
      if (key === "relationships" || key === "connected_accounts") return [];
      if (key === "consents") return {};
      if (key === "endpoint" && typeof value === "string") return "c-xxx00-00000000.discord.media:443";
    }

    if (typeof value === "string") {
      if (key === "user_settings_proto") return "[redacted]";
      if (key !== null && USER_NAME_KEYS.has(key)) return fakeUser(value);
      if (key === "name") return fakeName(value);
      if (key !== null && HASH_KEYS.has(key)) return redactHash(value);
      return redactString(value);
    }
    if (typeof value === "number") {
      return isSnowflakeText(String(value)) ? fakeSnowflake(String(value)) : value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => transform(item, null));
    }
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [childKey, childValue] of Object.entries(value)) {
        out[childKey] = transform(childValue, childKey);
      }
      return out;
    }
    return value;
  }

  function redactJson(value: unknown): unknown {
    assignSnowflakes(value);
    return transform(value, null);
  }

  function redactCurl(curlText: string): RedactedCurl {
    const text = curlText.replace(/\\\r?\n/g, " ");
    const methodMatch = text.match(/-X\s+([A-Z]+)/);
    const hasBody = /--data(-raw|-binary)?\s/.test(text);
    const method = methodMatch?.[1] ?? (hasBody ? "POST" : "GET");
    const url = redactString(text.match(/https?:\/\/[^\s'"]+/)?.[0] ?? "");

    const headers: Record<string, string> = {};
    for (const match of text.matchAll(/(?:-H|--header)\s+'([^']*)'/g)) {
      const raw = match[1] ?? "";
      const index = raw.indexOf(":");
      if (index <= 0) continue;
      const name = raw.slice(0, index).trim().toLowerCase();
      const value = raw.slice(index + 1).trim();
      headers[name] = redactHeader(name, value);
    }

    const bodyMatch = text.match(/--data(?:-raw|-binary)?\s+'([^']*)'/);
    let body: unknown = null;
    if (bodyMatch?.[1]) {
      try {
        body = redactJson(JSON.parse(bodyMatch[1]));
      } catch {
        body = redactString(bodyMatch[1]);
      }
    }

    return { method, url, headers, body };
  }

  function redactHeader(name: string, value: string): string {
    if (SECRET_KEYS.has(name)) return "[redacted]";
    if (name === "x-super-properties") {
      try {
        const decoded = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
        return Buffer.from(JSON.stringify(redactJson(decoded))).toString("base64");
      } catch {
        return "[redacted]";
      }
    }
    return redactString(value);
  }

  return { redactJson, redactCurl };
}

export function trimReady(payload: unknown, limit: number): unknown {
  if (payload === null || typeof payload !== "object") return payload;
  const root = payload as Record<string, unknown>;
  const data = root.d;
  if (data === null || typeof data !== "object" || Array.isArray(data)) return payload;

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      (data as Record<string, unknown>)[key] = value.slice(0, limit);
      continue;
    }
    if (value !== null && typeof value === "object") {
      const nested = value as Record<string, unknown>;
      for (const [nestedKey, nestedValue] of Object.entries(nested)) {
        if (Array.isArray(nestedValue)) nested[nestedKey] = nestedValue.slice(0, limit);
      }
    }
  }
  return payload;
}
