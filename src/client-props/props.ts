import { randomUUID } from "node:crypto";

export const CHROME_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

export interface SuperProperties {
  os: string;
  browser: string;
  release_channel: string;
  client_build_number: number;
  os_version: string;
  browser_user_agent: string;
  browser_version: string;
  system_locale: string;
  client_launch_id: string;
  client_heartbeat_session_id: string;
}

export interface ClientProps {
  superProperties(): SuperProperties;
  encoded(): string;
  headers(): Record<string, string>;
}

export interface ClientPropsOptions {
  buildNumber: number;
  locale?: string;
  now?: () => number;
}

const HEARTBEAT_ROTATE_MS = 30 * 60_000;
const BROWSER_VERSION = "142.0.0.0";

export function createClientProps(opts: ClientPropsOptions): ClientProps {
  const now = opts.now ?? Date.now;
  const locale = opts.locale ?? "es-AR";
  const launchId = randomUUID();
  let heartbeatId = randomUUID();
  let heartbeatAt = now();

  function superProperties(): SuperProperties {
    if (now() - heartbeatAt >= HEARTBEAT_ROTATE_MS) {
      heartbeatId = randomUUID();
      heartbeatAt = now();
    }
    return {
      os: "Linux",
      browser: "Chrome",
      release_channel: "stable",
      client_build_number: opts.buildNumber,
      os_version: "Linux",
      browser_user_agent: CHROME_UA,
      browser_version: BROWSER_VERSION,
      system_locale: locale,
      client_launch_id: launchId,
      client_heartbeat_session_id: heartbeatId,
    };
  }

  function encoded(): string {
    return Buffer.from(JSON.stringify(superProperties())).toString("base64");
  }

  function headers(): Record<string, string> {
    return {
      "User-Agent": CHROME_UA,
      "X-Super-Properties": encoded(),
      "X-Discord-Locale": locale,
      "X-Debug-Options": "bugReporterEnabled",
    };
  }

  return { superProperties, encoded, headers };
}
