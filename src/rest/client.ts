import { RateLimitedError, UnauthorizedError } from "./errors";
import type { Http } from "./http";

export interface RestClient {
  readonly closed: boolean;
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
}

const MAJOR_PARAM_PARENTS = new Set(["channels", "guilds", "webhooks"]);
const SNOWFLAKE = /^\d{17,20}$/;

export function routeKey(method: string, path: string): string {
  const clean = path.split("?")[0] ?? "";
  const out: string[] = [];
  for (const segment of clean.split("/")) {
    if (SNOWFLAKE.test(segment)) {
      const parent = out[out.length - 1];
      out.push(parent !== undefined && MAJOR_PARAM_PARENTS.has(parent) ? segment : ":id");
    } else {
      out.push(segment);
    }
  }
  return `${method.toUpperCase()} ${out.join("/")}`;
}

export interface RestClientDeps {
  http: Http;
  onUnauthorized(): void;
  sleep?(ms: number): Promise<void>;
}

const MAX_RATE_LIMIT_RETRIES = 3;

export function createRestClient(deps: RestClientDeps): RestClient {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const queues = new Map<string, Promise<unknown>>();
  let closed = false;
  let globalPause: Promise<void> | null = null;

  async function waitGlobal(): Promise<void> {
    if (globalPause !== null) await globalPause;
  }

  async function execute<T>(method: string, path: string, body: unknown): Promise<T> {
    await waitGlobal();
    if (closed) throw new UnauthorizedError(path);

    let attempts = 0;
    for (;;) {
      try {
        return await deps.http.request<T>(method, path, body);
      } catch (error) {
        if (error instanceof RateLimitedError) {
          attempts += 1;
          if (attempts >= MAX_RATE_LIMIT_RETRIES) throw error;
          if (error.global) {
            const pause = sleep(error.retryAfterMs);
            globalPause = pause;
            await pause;
            if (globalPause === pause) globalPause = null;
          } else {
            await sleep(error.retryAfterMs);
          }
          continue;
        }
        if (error instanceof UnauthorizedError) {
          if (!closed) {
            closed = true;
            deps.onUnauthorized();
          }
          throw error;
        }
        throw error;
      }
    }
  }

  function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    queues.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  return {
    get closed(): boolean {
      return closed;
    },
    request<T>(method: string, path: string, body?: unknown): Promise<T> {
      if (closed) return Promise.reject(new UnauthorizedError(path));
      return enqueue(routeKey(method, path), () => execute<T>(method, path, body));
    },
  };
}
