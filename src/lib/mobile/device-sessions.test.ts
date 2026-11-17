import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const fingerprint = vi.hoisted(() => ({ value: "password-fingerprint-v1" }));

vi.mock("@/lib/auth/session", () => ({ passwordFingerprint: () => fingerprint.value }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  authenticateMobileToken,
  authenticateMobileRequest,
  createMobileDeviceSession,
  MOBILE_SESSION_LIFETIME_MS,
  revokeMobileDeviceSession,
  type MobileSessionDb,
} from "./device-sessions";

type SessionRow = {
  id: string;
  tokenHash: string;
  deviceName: string;
  passwordFingerprint: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

function sessionDatabase() {
  const rows: SessionRow[] = [];
  const create = vi.fn(async ({ data }: { data: Omit<SessionRow, "id" | "lastUsedAt" | "revokedAt"> }) => {
    const row: SessionRow = { ...data, id: `session-${rows.length + 1}`, lastUsedAt: null, revokedAt: null };
    rows.push(row);
    return row;
  });
  const findUnique = vi.fn(async ({ where }: { where: { tokenHash: string } }) => rows.find((row) => row.tokenHash === where.tokenHash) ?? null);
  const updateMany = vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<SessionRow> }) => {
    const row = rows.find((candidate) => {
      if (typeof where.id === "string" && candidate.id !== where.id) return false;
      if (typeof where.tokenHash === "string" && candidate.tokenHash !== where.tokenHash) return false;
      if (where.revokedAt === null && candidate.revokedAt !== null) return false;
      if (typeof where.passwordFingerprint === "string" && candidate.passwordFingerprint !== where.passwordFingerprint) return false;
      const expires = where.expiresAt as { gt?: Date } | undefined;
      if (expires?.gt && candidate.expiresAt <= expires.gt) return false;
      return true;
    });
    if (!row) return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  });
  const db = { mobileDeviceSession: { create, findUnique, updateMany } } as unknown as MobileSessionDb;
  return { db, rows, create, findUnique, updateMany };
}

describe("mobile device sessions", () => {
  beforeEach(() => {
    fingerprint.value = "password-fingerprint-v1";
  });

  it("returns a 30-day random bearer token while storing only its SHA-256 hash", async () => {
    const { db, rows } = sessionDatabase();
    const now = new Date("2026-11-17T21:15:00.000Z");

    const created = await createMobileDeviceSession("Saahil's iPhone", db, now);

    expect(created.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.expiresAt).toBe(new Date(now.getTime() + MOBILE_SESSION_LIFETIME_MS).toISOString());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tokenHash: createHash("sha256").update(created.accessToken, "utf8").digest("hex"),
      deviceName: "Saahil's iPhone",
      passwordFingerprint: "password-fingerprint-v1",
      createdAt: now,
      expiresAt: new Date(created.expiresAt),
      revokedAt: null,
    });
    expect(JSON.stringify(rows)).not.toContain(created.accessToken);
  });

  it("authenticates active sessions and updates last-used time", async () => {
    const { db, rows } = sessionDatabase();
    const created = await createMobileDeviceSession("Test iPhone", db, new Date("2026-11-17T00:00:00.000Z"));
    const now = new Date("2026-11-18T00:00:00.000Z");

    await expect(authenticateMobileToken(created.accessToken, db, now)).resolves.toMatchObject({
      id: "session-1",
      deviceName: "Test iPhone",
      expiresAt: new Date(created.expiresAt),
    });
    expect(rows[0].lastUsedAt).toEqual(now);
  });

  it("rejects expired, revoked, password-invalidated, and malformed tokens", async () => {
    const { db, rows, findUnique } = sessionDatabase();
    const now = new Date("2026-11-17T00:00:00.000Z");
    const created = await createMobileDeviceSession("Test device", db, now);

    await expect(authenticateMobileToken(created.accessToken, db, new Date(created.expiresAt))).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalledTimes(1);

    fingerprint.value = "password-fingerprint-v2";
    await expect(authenticateMobileToken(created.accessToken, db, now)).resolves.toBeNull();
    fingerprint.value = "password-fingerprint-v1";

    await revokeMobileDeviceSession("session-1", db, now);
    expect(rows[0].revokedAt).toEqual(now);
    await expect(authenticateMobileToken(created.accessToken, db, now)).resolves.toBeNull();
    await expect(authenticateMobileToken("not-a-token", db, now)).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalledTimes(3);
  });

  it("does not treat a web cookie, query parameter, or malformed bearer value as mobile authentication", async () => {
    const cookieOnly = new Request("https://dossier.test/api/mobile/v1/profile", {
      headers: { cookie: "dossier_session=valid-web-session" },
    });
    const queryToken = new Request("https://dossier.test/api/mobile/v1/profile?access_token=some-token");
    const malformed = new Request("https://dossier.test/api/mobile/v1/profile", {
      headers: { authorization: "Bearer invalid" },
    });

    await expect(authenticateMobileRequest(cookieOnly)).resolves.toBeNull();
    await expect(authenticateMobileRequest(queryToken)).resolves.toBeNull();
    await expect(authenticateMobileRequest(malformed)).resolves.toBeNull();
  });
});
