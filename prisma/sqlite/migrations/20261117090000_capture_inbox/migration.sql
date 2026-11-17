-- CreateTable
CREATE TABLE "Capture" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientRequestId" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "dedupeUrl" TEXT NOT NULL,
    "canonicalEmployerUrl" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'WEB',
    "ingestionState" TEXT NOT NULL DEFAULT 'SAVED',
    "ingestionError" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Capture_clientRequestId_key" ON "Capture"("clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Capture_dedupeUrl_key" ON "Capture"("dedupeUrl");

-- CreateIndex
CREATE INDEX "Capture_ingestionState_updatedAt_idx" ON "Capture"("ingestionState", "updatedAt");
