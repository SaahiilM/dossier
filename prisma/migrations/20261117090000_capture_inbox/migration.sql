-- CreateEnum
CREATE TYPE "CaptureSource" AS ENUM ('WEB', 'IOS_SHARE');

-- CreateEnum
CREATE TYPE "CaptureIngestionState" AS ENUM ('SAVED', 'NEEDS_DETAILS', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "Capture" (
    "id" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "dedupeUrl" TEXT NOT NULL,
    "canonicalEmployerUrl" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "source" "CaptureSource" NOT NULL DEFAULT 'WEB',
    "ingestionState" "CaptureIngestionState" NOT NULL DEFAULT 'SAVED',
    "ingestionError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Capture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Capture_clientRequestId_key" ON "Capture"("clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Capture_dedupeUrl_key" ON "Capture"("dedupeUrl");

-- CreateIndex
CREATE INDEX "Capture_ingestionState_updatedAt_idx" ON "Capture"("ingestionState", "updatedAt");
