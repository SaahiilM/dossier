-- AlterTable
ALTER TABLE "AgentCandidate" ADD COLUMN     "meta" JSONB,
ADD COLUMN     "inputFingerprint" TEXT,
ADD COLUMN     "scoredWith" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "PostingScore" ADD COLUMN     "meta" JSONB,
ADD COLUMN     "inputFingerprint" TEXT;
