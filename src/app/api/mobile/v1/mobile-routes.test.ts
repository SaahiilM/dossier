import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticateMobileRequest: vi.fn(),
  revokeMobileDeviceSession: vi.fn(),
  listMobileApplications: vi.fn(),
  getMobileApplication: vi.fn(),
  getMobileProfile: vi.fn(),
}));

vi.mock("@/lib/mobile/device-sessions", () => ({
  authenticateMobileRequest: (...args: unknown[]) => state.authenticateMobileRequest(...args),
  revokeMobileDeviceSession: (...args: unknown[]) => state.revokeMobileDeviceSession(...args),
}));
vi.mock("@/lib/mobile/resources", () => ({
  listMobileApplications: (...args: unknown[]) => state.listMobileApplications(...args),
  getMobileApplication: (...args: unknown[]) => state.getMobileApplication(...args),
  getMobileProfile: (...args: unknown[]) => state.getMobileProfile(...args),
}));

import { POST as logout } from "./auth/logout/route";
import { GET as applications } from "./applications/route";
import { GET as applicationDetail } from "./applications/[id]/route";
import { GET as profile } from "./profile/route";

const bearer = new Request("https://dossier.test/api/mobile/v1/applications", {
  headers: { authorization: `Bearer ${"A".repeat(43)}` },
});

describe("mobile protected routes", () => {
  beforeEach(() => {
    state.authenticateMobileRequest.mockReset().mockResolvedValue({ id: "session-1", deviceName: "Test phone", expiresAt: new Date("2026-12-17T00:00:00.000Z") });
    state.revokeMobileDeviceSession.mockReset().mockResolvedValue(undefined);
    state.listMobileApplications.mockReset().mockResolvedValue({ items: [], nextCursor: null });
    state.getMobileApplication.mockReset().mockResolvedValue(null);
    state.getMobileProfile.mockReset().mockResolvedValue({ basics: { name: "Test User" } });
  });

  it("does not accept a web cookie in place of a bearer token", async () => {
    state.authenticateMobileRequest.mockResolvedValue(null);
    const cookieOnly = new Request("https://dossier.test/api/mobile/v1/applications", {
      headers: { cookie: "dossier_session=valid-web-session" },
    });
    const response = await applications(cookieOnly);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "unauthorized", message: "Sign in to continue." } });
    expect(state.listMobileApplications).not.toHaveBeenCalled();
  });

  it("returns the cursor envelope for the authenticated list", async () => {
    state.listMobileApplications.mockResolvedValue({ items: [{ id: "app-1" }], nextCursor: "eyJ2ZXJzaW9uIjoxfQ" });
    const response = await applications(bearer);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [{ id: "app-1" }], nextCursor: "eyJ2ZXJzaW9uIjoxfQ" });
  });

  it("rejects duplicate query cursors", async () => {
    const duplicate = new Request("https://dossier.test/api/mobile/v1/applications?cursor=a&cursor=b", { headers: bearer.headers });
    const response = await applications(duplicate);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect(state.listMobileApplications).not.toHaveBeenCalled();
  });

  it("returns 404 for unavailable detail and the DTO envelope for a found record", async () => {
    const context = { params: Promise.resolve({ id: "app-1" }) };
    const missing = await applicationDetail(bearer, context);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "not_found" } });

    state.getMobileApplication.mockResolvedValue({ id: "app-1", status: "DRAFT" });
    const found = await applicationDetail(bearer, context);
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ application: { id: "app-1", status: "DRAFT" } });
  });

  it("returns the profile envelope and revokes the authenticated device on logout", async () => {
    const profileResponse = await profile(new Request("https://dossier.test/api/mobile/v1/profile", { headers: bearer.headers }));
    expect(profileResponse.status).toBe(200);
    expect(await profileResponse.json()).toEqual({ profile: { basics: { name: "Test User" } } });

    const logoutRequest = new Request("https://dossier.test/api/mobile/v1/auth/logout", {
      method: "POST",
      headers: bearer.headers,
    });
    const logoutResponse = await logout(logoutRequest);
    expect(logoutResponse.status).toBe(200);
    expect(await logoutResponse.json()).toEqual({ ok: true });
    expect(state.revokeMobileDeviceSession).toHaveBeenCalledWith("session-1");
  });

  it("rejects logout bodies and does not revoke a session", async () => {
    const request = new Request("https://dossier.test/api/mobile/v1/auth/logout", {
      method: "POST",
      headers: { ...Object.fromEntries(bearer.headers), "content-type": "application/json" },
      body: "{}",
    });
    const response = await logout(request);

    expect(response.status).toBe(400);
    expect(state.revokeMobileDeviceSession).not.toHaveBeenCalled();
  });
});
