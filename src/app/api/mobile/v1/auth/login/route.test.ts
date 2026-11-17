import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  passwordMatches: vi.fn(),
  succeeded: vi.fn(),
  startLoginAttempt: vi.fn(),
  createMobileDeviceSession: vi.fn(),
  allowed: true,
  waitMs: 4_000,
}));

vi.mock("@/lib/auth/session", () => ({ passwordMatches: state.passwordMatches }));
vi.mock("@/lib/auth/login-throttle", () => ({
  startLoginAttempt: (...args: unknown[]) => state.startLoginAttempt(...args),
}));
vi.mock("@/lib/mobile/device-sessions", () => ({
  createMobileDeviceSession: (...args: unknown[]) => state.createMobileDeviceSession(...args),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { POST } from "./route";

const makeRequest = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://dossier.test/api/mobile/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });

describe("POST /api/mobile/v1/auth/login", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    state.allowed = true;
    state.waitMs = 4_000;
    state.passwordMatches.mockReset().mockResolvedValue(true);
    state.succeeded.mockReset().mockResolvedValue(undefined);
    state.startLoginAttempt.mockReset().mockImplementation(async () => {
      return state.allowed
        ? { allowed: true, succeeded: state.succeeded }
        : { allowed: false, waitMs: state.waitMs, limit: "client" };
    });
    state.createMobileDeviceSession.mockReset().mockResolvedValue({
      accessToken: "A".repeat(43),
      expiresAt: "2026-12-17T21:15:00.000Z",
    });
  });

  it("uses the existing password verifier and throttle, then returns a 30-day session DTO", async () => {
    const response = await POST(makeRequest(JSON.stringify({ password: "secret", deviceName: "  iPhone  " }), { "x-forwarded-for": "203.0.113.9" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ accessToken: "A".repeat(43), expiresAt: "2026-12-17T21:15:00.000Z" });
    expect(state.startLoginAttempt).toHaveBeenCalledTimes(1);
    expect(state.startLoginAttempt.mock.calls[0][1]).toMatchObject({ ip: "203.0.113.9", browser: null });
    expect(state.passwordMatches).toHaveBeenCalledWith("secret");
    expect(state.succeeded).toHaveBeenCalledOnce();
    expect(state.createMobileDeviceSession).toHaveBeenCalledWith("iPhone");
  });

  it("counts a bad password but does not create a session or reset the throttle", async () => {
    state.passwordMatches.mockResolvedValue(false);
    const response = await POST(makeRequest(JSON.stringify({ password: "wrong" })));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_credentials" } });
    expect(state.succeeded).not.toHaveBeenCalled();
    expect(state.createMobileDeviceSession).not.toHaveBeenCalled();
  });

  it("refuses a throttled attempt before checking the password and returns Retry-After", async () => {
    state.allowed = false;
    state.waitMs = 3_100;
    const response = await POST(makeRequest(JSON.stringify({ password: "secret" })));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("4");
    expect(await response.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect(state.passwordMatches).not.toHaveBeenCalled();
  });

  it("requires HTTPS in production, including behind the trusted reverse proxy", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const plainHttp = await POST(new Request("http://dossier.test/api/mobile/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "secret" }),
    }));
    expect(plainHttp.status).toBe(400);
    expect(state.startLoginAttempt).not.toHaveBeenCalled();

    const proxiedHttps = await POST(new Request("http://dossier.test/api/mobile/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
      body: JSON.stringify({ password: "secret" }),
    }));
    expect(proxiedHttps.status).toBe(200);
  });

  it("enforces JSON, strict fields, and the 8 KiB streaming body limit", async () => {
    const wrongType = await POST(makeRequest(JSON.stringify({ password: "secret" }), { "content-type": "text/plain" }));
    const unknownField = await POST(makeRequest(JSON.stringify({ password: "secret", remember: true })));
    const oversized = await POST(makeRequest(JSON.stringify({ password: "x".repeat(8_500) })));

    expect(wrongType.status).toBe(415);
    expect(unknownField.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(state.passwordMatches).not.toHaveBeenCalled();
  });
});
