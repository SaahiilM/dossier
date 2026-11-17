CREATE TABLE "MobileDeviceSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "passwordFingerprint" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME
);

CREATE UNIQUE INDEX "MobileDeviceSession_tokenHash_key" ON "MobileDeviceSession"("tokenHash");
CREATE INDEX "MobileDeviceSession_expiresAt_idx" ON "MobileDeviceSession"("expiresAt");
CREATE INDEX "MobileDeviceSession_revokedAt_idx" ON "MobileDeviceSession"("revokedAt");
