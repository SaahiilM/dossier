import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticateMobileRequest: vi.fn(),
  getMobileSetup: vi.fn(),
}));

vi.mock("@/lib/mobile/device-sessions", () => ({
  authenticateMobileRequest: (...args: unknown[]) => state.authenticateMobileRequest(...args),
}));
vi.mock("@/lib/mobile/resources", () => ({
  getMobileSetup: (...args: unknown[]) => state.getMobileSetup(...args),
}));

import { GET } from "./route";

const url = "https://dossier.test/api/mobile/v1/setup";
const bearer = new Request(url, { headers: { authorization: `Bearer ${"A".repeat(43)}` } });

describe("GET /api/mobile/v1/setup", () => {
  beforeEach(() => {
    state.authenticateMobileRequest.mockReset().mockResolvedValue({ id: "session-1" });
    state.getMobileSetup.mockReset().mockResolvedValue({ profileReady: true, aiConfigured: false, setupInProgress: true });
  });

  it("requires bearer authentication before reading setup status", async () => {
    state.authenticateMobileRequest.mockResolvedValue(null);
    const response = await GET(new Request(url, { headers: { cookie: "dossier_session=web-session" } }));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "unauthorized", message: "Sign in to continue." } });
    expect(state.getMobileSetup).not.toHaveBeenCalled();
  });

  it("returns only the setup booleans in a private response", async () => {
    const response = await GET(bearer);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ profileReady: true, aiConfigured: false, setupInProgress: true });
  });
});
