export type MobileErrorCode =
  | "invalid_request"
  | "invalid_credentials"
  | "unauthorized"
  | "not_found"
  | "payload_too_large"
  | "unsupported_media_type"
  | "rate_limited"
  | "internal_error";

export class MobileApiError extends Error {
  constructor(
    readonly code: MobileErrorCode,
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

export const invalidRequest = () => new MobileApiError("invalid_request", "The request is invalid.", 400);
export const unauthorized = () => new MobileApiError("unauthorized", "Sign in to continue.", 401);
