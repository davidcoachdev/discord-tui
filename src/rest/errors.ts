export class HttpError extends Error {
  readonly status: number;
  readonly route: string;
  readonly code?: number;

  constructor(status: number, route: string, code?: number) {
    super(`HTTP ${status} on ${route}`);
    this.name = "HttpError";
    this.status = status;
    this.route = route;
    this.code = code;
  }
}

export class UnauthorizedError extends HttpError {
  constructor(route: string, code?: number) {
    super(401, route, code);
    this.name = "UnauthorizedError";
  }
}

/** La respuesta llegó con status OK pero el cuerpo no era JSON. */
export class InvalidResponseError extends HttpError {
  readonly contentType: string;
  readonly bytes: number;

  constructor(route: string, status: number, contentType: string, bytes: number) {
    super(status, route);
    this.name = "InvalidResponseError";
    this.contentType = contentType;
    this.bytes = bytes;
  }
}

export class RateLimitedError extends HttpError {
  readonly retryAfterMs: number;
  readonly global: boolean;
  readonly scope: string | null;

  constructor(route: string, retryAfterMs: number, global: boolean, scope: string | null) {
    super(429, route);
    this.name = "RateLimitedError";
    this.retryAfterMs = retryAfterMs;
    this.global = global;
    this.scope = scope;
  }
}

export class CaptchaRequiredError extends Error {
  constructor(route: string) {
    super(`captcha required on ${route}`);
    this.name = "CaptchaRequiredError";
  }
}

export class NetworkError extends Error {
  constructor(method: string, route: string, options?: { cause?: unknown }) {
    super(`network error on ${method} ${route}`, options);
    this.name = "NetworkError";
  }
}
