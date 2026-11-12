-- AlterTable
ALTER TABLE "AgentCandidate" ADD COLUMN "meta" JSON;
ALTER TABLE "AgentCandidate" ADD COLUMN "inputFingerprint" TEXT;
ALTER TABLE "AgentCandidate" ADD COLUMN "scoredWith" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "PostingScore" ADD COLUMN "meta" JSON;
ALTER TABLE "PostingScore" ADD COLUMN "inputFingerprint" TEXT;
