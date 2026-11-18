import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  findFirst: vi.fn(),
  loadProfile: vi.fn(),
  loadProfileName: vi.fn(),
  loadSettings: vi.fn(),
  isAiConfigured: vi.fn(),
}));

vi.mock("@/lib/ai/config", () => ({ isAiConfigured: (...args: unknown[]) => state.isAiConfigured(...args) }));
vi.mock("@/lib/applications-data", () => ({ loadApplicationRows: vi.fn(async () => state.rows) }));
vi.mock("@/lib/profile-data", () => ({
  loadProfile: state.loadProfile,
  loadProfileName: (...args: unknown[]) => state.loadProfileName(...args),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { application: { findFirst: state.findFirst } } }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: (...args: unknown[]) => state.loadSettings(...args) }));

import { getMobileApplication, getMobileSetup, listMobileApplications, MOBILE_LIST_PAGE_SIZE } from "./resources";

const item = (index: number, updatedAt = new Date("2026-11-17T00:00:00.000Z").getTime()) => ({
  id: `application-${String(index).padStart(3, "0")}`,
  company: `Company ${index}`,
  role: `Role ${index}`,
  location: "New York",
  mode: "Hybrid",
  status: "DRAFT" as const,
  archived: false,
  deadline: null,
  match: null,
  score: null,
  sent: null,
  updated: "Today",
  updatedAt,
  boardSort: null,
});

describe("mobile resource DTOs", () => {
  beforeEach(() => {
    state.rows = [];
    state.findFirst.mockReset();
    state.loadProfile.mockReset();
    state.loadProfileName.mockReset().mockResolvedValue("");
    state.loadSettings.mockReset().mockResolvedValue({ setupGuide: null, provider: null, apiKeyEnc: null });
    state.isAiConfigured.mockReset().mockResolvedValue(false);
  });

  it("paginates newest-first with an opaque keyset cursor and no duplicate rows", async () => {
    state.rows = Array.from({ length: MOBILE_LIST_PAGE_SIZE + 2 }, (_, index) => item(index));
    const first = await listMobileApplications();
    expect(first.items).toHaveLength(MOBILE_LIST_PAGE_SIZE);
    expect(first.items[0].id).toBe("application-051");
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.items[0].updatedAt).toBe("2026-11-17T00:00:00.000Z");

    const second = await listMobileApplications(first.nextCursor ?? undefined);
    expect(second.items.map(({ id }) => id)).toEqual(["application-001", "application-000"]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects malformed cursors", async () => {
    await expect(listMobileApplications("not valid!" )).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    await expect(listMobileApplications(Buffer.from('{"version":2}', "utf8").toString("base64url"))).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
  });

  it("returns a detail DTO with safe URLs, normalized dates, and validated extraction/match data", async () => {
    state.findFirst.mockResolvedValue({
      id: "application-1",
      title: "Designer",
      company: "Northwind",
      role: "Product designer",
      location: "New York",
      mode: "Hybrid",
      salary: "",
      status: "INTERVIEW",
      archivedAt: null,
      deadline: new Date("2026-12-01T00:00:00.000Z"),
      postingUrl: "javascript:alert(1)",
      postingText: "Original posting",
      extracted: null,
      match: { invalid: true },
      language: "English",
      sentAt: new Date("2026-11-17T12:00:00.000Z"),
      nextInterviewAt: null,
      createdAt: new Date("2026-11-01T00:00:00.000Z"),
      updatedAt: new Date("2026-11-17T12:00:00.000Z"),
      notes: [{
        id: "note-1",
        body: "Called John.",
        createdAt: new Date("2026-11-17T11:00:00.000Z"),
        updatedAt: new Date("2026-11-17T12:00:00.000Z"),
      }],
    });

    await expect(getMobileApplication("application-1")).resolves.toMatchObject({
      id: "application-1",
      role: "Product designer",
      archived: false,
      deadline: "2026-12-01",
      postingUrl: "",
      postingText: "Original posting",
      sentAt: "2026-11-17T12:00:00.000Z",
      nextInterviewAt: null,
      notes: [{ id: "note-1", body: "Called John.", createdAt: "2026-11-17T11:00:00.000Z", updatedAt: "2026-11-17T12:00:00.000Z" }],
      extracted: { title: "Designer", company: "Northwind", requirements: [] },
      match: null,
    });
  });

  it("treats an older incomplete account as not ready or in progress", async () => {
    await expect(getMobileSetup()).resolves.toEqual({ profileReady: false, aiConfigured: false, setupInProgress: false });
  });

  it("uses the shared setup predicates and omits saved setup and provider settings", async () => {
    state.loadProfileName.mockResolvedValue("  Jane Doe  ");
    state.loadSettings.mockResolvedValue({
      setupGuide: { step: "profile", finished: false },
      provider: "OPENAI",
      apiKeyEnc: "encrypted-provider-credential",
    });
    // This shared predicate means a provider was selected, not that it was tested or reachable.
    state.isAiConfigured.mockResolvedValue(true);

    const result = await getMobileSetup();

    expect(result).toEqual({ profileReady: true, aiConfigured: true, setupInProgress: true });
    expect(Object.keys(result).sort()).toEqual(["aiConfigured", "profileReady", "setupInProgress"]);
    expect(JSON.stringify(result)).not.toMatch(/OPENAI|encrypted-provider-credential|"step"|"finished"/);
  });
});
