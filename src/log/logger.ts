import { fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";

import { logPath } from "../config/paths";
import { TOKEN_PATTERNS } from "../security/token-pattern";

export const ALLOWED_FIELDS = [
  "method",
  "route",
  "status",
  "code",
  "op",
  "t",
  "seq",
  "close_code",
  "guild_id",
  "channel_id",
  "message_id",
  "state",
  "attempt",
  "duration_ms",
  "error_name",
  "msg",
  "count",
  "mode",
  "packets",
  "decode_errors",
  "peak_db",
  "ref_db",
] as const;

export type AllowedField = (typeof ALLOWED_FIELDS)[number];
export type LogFields = Partial<Record<AllowedField, string | number | boolean | null>>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  flush(): Promise<void>;
}

const allowed = new Set<string>(ALLOWED_FIELDS);

function redactTokens(value: string): string {
  let out = value;
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out;
}

export function createLogger(opts: { file?: string } = {}): Logger {
  const file = opts.file ?? logPath();
  let fd: number | null = null;

  function write(level: "info" | "warn" | "error", event: string, fields: LogFields = {}): void {
    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      event: redactTokens(event),
    };
    for (const [key, value] of Object.entries(fields)) {
      if (!allowed.has(key)) {
        record[key] = "[dropped]";
      } else {
        record[key] = typeof value === "string" ? redactTokens(value) : value;
      }
    }
    if (fd === null) {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      fd = openSync(file, "a", 0o600);
    }
    writeSync(fd, JSON.stringify(record) + "\n");
  }

  return {
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
    flush: async () => {
      if (fd !== null) fsyncSync(fd);
    },
  };
}

let defaultLogger: Logger | null = null;
let defaultFile: string | null = null;

function defaultLoggerForCurrentPath(): Logger {
  const file = logPath();
  if (defaultLogger === null || defaultFile !== file) {
    defaultLogger = createLogger({ file });
    defaultFile = file;
  }
  return defaultLogger;
}

export const log: Logger = {
  info: (event, fields) => defaultLoggerForCurrentPath().info(event, fields),
  warn: (event, fields) => defaultLoggerForCurrentPath().warn(event, fields),
  error: (event, fields) => defaultLoggerForCurrentPath().error(event, fields),
  flush: () => defaultLoggerForCurrentPath().flush(),
};
