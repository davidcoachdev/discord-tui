import type { ClientProps } from "../client-props/props";
import { log, type LogFields } from "../log/logger";
import type { Secret } from "../secret";
import { CaptchaRequiredError, HttpError, InvalidResponseError, NetworkError, UnauthorizedError } from "./errors";

const DEFAULT_BASE_URL = "https://discord.com/api/v9";
const SNOWFLAKE_SEGMENT = /\/\d{17,20}(?=\/|$)/g;

export interface Http {
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
}

export interface HttpDeps {
  props: ClientProps;
  token?: Secret;
  baseUrl?: string;
  fetch?: typeof fetch;
}

function routeTemplate(path: string): string {
  return path.split("?")[0]!.replace(SNOWFLAKE_SEGMENT, "/:id");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function numericCode(body: Record<string, unknown> | null): number | undefined {
  return typeof body?.code === "number" ? body.code : undefined;
}

export function createHttp(deps: HttpDeps): Http {
  const base = deps.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = deps.fetch ?? fetch;

  return {
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const route = routeTemplate(path);
      const url = new URL(path, base.endsWith("/") ? base : base + "/");

      const headers: Record<string, string> = { ...deps.props.headers() };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      // El token solo viaja a Discord; 127.0.0.1 es el servidor falso de los tests.
      const host = url.hostname;
      if (deps.token && (host === "discord.com" || host === "127.0.0.1" || host === "localhost")) {
        headers.Authorization = deps.token.reveal();
      }

      let response: Response;
      try {
        response = await doFetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (error) {
        const fields: LogFields = { method, route };
        if (error instanceof Error) fields.error_name = error.name;
        log.error("http.network", fields);
        throw new NetworkError(method, route, { cause: error });
      }

      const text = await response.text().catch(() => "");
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      const parsed = asRecord(data);
      const captcha = parsed !== null && ("captcha_key" in parsed || "captcha_sitekey" in parsed);

      if (!response.ok || captcha) {
        const code = numericCode(parsed);
        const fields: LogFields = { method, route, status: response.status };
        if (code !== undefined) fields.code = code;
        log.error("http.error", fields);

        if (captcha) throw new CaptchaRequiredError(route);
        if (response.status === 401) throw new UnauthorizedError(route, code);
        throw new HttpError(response.status, route, code);
      }

      if (text.length > 0 && data === null) {
        const contentType = response.headers.get("content-type") ?? "";
        const encoding = response.headers.get("content-encoding") ?? "";
        const detail = `${contentType || "sin content-type"}${encoding ? `; encoding=${encoding}` : ""}`;
        log.error("http.non-json", {
          method,
          route,
          status: response.status,
          msg: detail,
          count: text.length,
        });
        throw new InvalidResponseError(route, response.status, detail, text.length);
      }

      return data as T;
    },
  };
}
