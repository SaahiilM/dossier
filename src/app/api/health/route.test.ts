import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { appVersion } from "@/lib/version";

import { GET } from "./route";

vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: vi.fn() } }));

describe("GET /api/health (E12-4)", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.unstubAllEnvs());

  it("answers 200 with the version when the database answers", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ "?column?": 1 }] as never);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", version: appVersion, db: "ok" });
  });

  it("includes the immutable build identity when this is a tagged deployment", async () => {
    vi.stubEnv("DOSSIER_BUILD_SHA", "d4405d1f9161d47b0c8616f0a39b63c695ac0e48");
    vi.stubEnv("DOSSIER_BUILD_TIME", "2026-11-17T12:00:00Z");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ "?column?": 1 }] as never);
    const response = await GET();
    expect(await response.json()).toEqual({
      status: "ok",
      version: appVersion,
      build: "d4405d1f9161d47b0c8616f0a39b63c695ac0e48",
      builtAt: "2026-11-17T12:00:00Z",
      db: "ok",
    });
  });

  it("answers 503 when the database fails", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("connection refused") as never);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable", version: appVersion, db: "unreachable" });
  });

  it("answers 503 when the database doesn't answer in time", async () => {
    vi.useFakeTimers();
    vi.mocked(prisma.$queryRaw).mockReturnValue(new Promise(() => {}) as never);
    const pending = GET();
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await pending).status).toBe(503);
  });
});
