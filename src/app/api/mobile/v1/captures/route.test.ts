import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

const stubs = vi.hoisted(() => ({
  authenticate: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/mobile/device-sessions", () => ({ authenticateMobileRequest: stubs.authenticate }));
vi.mock("@/lib/captures/service", () => ({
  createCapture: stubs.create,
  listCaptures: stubs.list,
  CaptureConflictError: class extends Error {},
  CaptureNotFoundError: class extends Error {},
}));

const url = "https://dossier.example/api/mobile/v1/captures";
const posting = "https://www.linkedin.com/jobs/view/1234/";
const row = {
  id: "capture-1",
  originalUrl: posting,
  ingestionState: "NEEDS_DETAILS",
  text: "",
  note: "",
  canonicalEmployerUrl: "",
  createdAt: new Date("2026-11-17T12:00:00Z"),
  updatedAt: new Date("2026-11-17T12:00:00Z"),
};

beforeEach(() => {
  vi.resetAllMocks();
  stubs.authenticate.mockResolvedValue({ id: "device" });
  stubs.create.mockResolvedValue(row);
  stubs.list.mockResolvedValue({ items: [row], nextCursor: null });
});

describe("mobile captures", () => {
  it("requires device authentication before reading or writing captures", async () => {
    stubs.authenticate.mockResolvedValue(null);
    expect((await GET(new Request(url))).status).toBe(401);
    expect((await POST(new Request(url, { method: "POST" }))).status).toBe(401);
    expect(stubs.list).not.toHaveBeenCalled();
    expect(stubs.create).not.toHaveBeenCalled();
  });

  it("passes the retry ID through and returns matching create and list DTOs", async () => {
    const response = await POST(new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: posting, clientRequestId: "retry-1" }),
    }));
    expect(response.status).toBe(200);
    expect(stubs.create).toHaveBeenCalledWith(expect.objectContaining({
      url: posting, clientRequestId: "retry-1", source: "IOS_SHARE",
    }));
    const { capture } = await response.json();
    expect(capture).toMatchObject({ id: row.id, url: posting, state: "NEEDS_DETAILS" });
    expect(await (await GET(new Request(url))).json()).toEqual({ items: [capture], nextCursor: null });
  });
});
