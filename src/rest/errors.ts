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
