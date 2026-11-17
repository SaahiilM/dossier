-- CreateTable
CREATE TABLE "MobileDeviceSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "passwordFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MobileDeviceSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MobileDeviceSession_tokenHash_key" ON "MobileDeviceSession"("tokenHash");

-- CreateIndex
CREATE INDEX "MobileDeviceSession_expiresAt_idx" ON "MobileDeviceSession"("expiresAt");

-- CreateIndex
CREATE INDEX "MobileDeviceSession_revokedAt_idx" ON "MobileDeviceSession"("revokedAt");
