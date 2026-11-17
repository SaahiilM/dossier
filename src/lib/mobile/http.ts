import { z } from "zod";

import { MobileApiError, invalidRequest } from "@/lib/mobile/errors";

const JSON_CONTENT_TYPE = "application/json";

export function mobileJson<T>(data: T, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { status, headers });
}

export function mobileError(error: unknown): Response {
  const known = error instanceof MobileApiError ? error : new MobileApiError("internal_error", "Something went wrong.", 500);
  const headers = new Headers();
  if (known.retryAfterSeconds !== undefined) headers.set("Retry-After", String(known.retryAfterSeconds));
  return mobileJson({ error: { code: known.code, message: known.message } }, known.status, headers);
}

export function requireSecureTransport(request: Request): void {
  if (process.env.NODE_ENV !== "production") return;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim().toLowerCase();
  if (new URL(request.url).protocol === "https:" || forwardedProto === "https") return;
  throw new MobileApiError("invalid_request", "Use HTTPS for mobile API requests.", 400);
}

/** Reads JSON without ever buffering more than `maxBytes` from an untrusted request. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== JSON_CONTENT_TYPE) {
    throw new MobileApiError("unsupported_media_type", "Send a JSON request body.", 415);
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) throw invalidRequest();
    if (Number(contentLength) > maxBytes) throw new MobileApiError("payload_too_large", "The request body is too large.", 413);
  }

  if (!request.body) throw invalidRequest();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new MobileApiError("payload_too_large", "The request body is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw invalidRequest();
  }
}

export function parseBody<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidRequest();
  return parsed.data;
}

/** Logout has no request body; stop after the first byte to keep it bounded. */
export async function requireEmptyBody(request: Request): Promise<void> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > 0)) throw invalidRequest();
  if (!request.body) return;
  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value.byteLength > 0) {
        await reader.cancel();
        throw invalidRequest();
      }
    }
  } finally {
    reader.releaseLock();
  }
}
