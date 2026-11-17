import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { passwordFingerprint } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export const MOBILE_SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type MobileSessionDb = Pick<PrismaClient, "mobileDeviceSession">;

export type MobilePrincipal = {
  id: string;
  deviceName: string;
  expiresAt: Date;
};

export function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function createMobileDeviceSession(
  deviceName: string,
  db: MobileSessionDb = prisma,
  now = new Date(),
): Promise<{ accessToken: string; expiresAt: string }> {
  const accessToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + MOBILE_SESSION_LIFETIME_MS);
  await db.mobileDeviceSession.create({
    data: {
      tokenHash: tokenHash(accessToken),
      deviceName,
      passwordFingerprint: passwordFingerprint(),
      createdAt: now,
      expiresAt,
    },
  });
  return { accessToken, expiresAt: expiresAt.toISOString() };
}

export async function authenticateMobileToken(
  token: string,
  db: MobileSessionDb = prisma,
  now = new Date(),
): Promise<MobilePrincipal | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const digest = tokenHash(token);
  const currentFingerprint = passwordFingerprint();
  const session = await db.mobileDeviceSession.findUnique({ where: { tokenHash: digest } });
  if (
    !session ||
    session.revokedAt !== null ||
    session.expiresAt.getTime() <= now.getTime() ||
    session.passwordFingerprint !== currentFingerprint
  ) {
    return null;
  }

  // A conditional write closes the race with a simultaneous logout/revocation.
  const touched = await db.mobileDeviceSession.updateMany({
    where: { id: session.id, tokenHash: digest, revokedAt: null, expiresAt: { gt: now }, passwordFingerprint: currentFingerprint },
    data: { lastUsedAt: now },
  });
  if (touched.count !== 1) return null;
  return { id: session.id, deviceName: session.deviceName, expiresAt: session.expiresAt };
}

export async function revokeMobileDeviceSession(
  sessionId: string,
  db: MobileSessionDb = prisma,
  now = new Date(),
): Promise<void> {
  await db.mobileDeviceSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now },
  });
}

export async function authenticateMobileRequest(request: Request): Promise<MobilePrincipal | null> {
  if (process.env.NODE_ENV === "production") {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim().toLowerCase();
    if (new URL(request.url).protocol !== "https:" && forwardedProto !== "https") return null;
  }
  const value = request.headers.get("authorization");
  const match = value?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i);
  return match ? authenticateMobileToken(match[1]) : null;
}
