import "server-only";

import { parsePostingFitMeta, type PostingFit } from "@/lib/fit";
import type { FoundPosting } from "@/lib/job-search/search";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { stringsOf } from "./agent/candidates";

// Scores kept per posting (#208): from Score in Find jobs, or the job agent.

/** Keeps a posting's score, replacing an older one. */
export async function saveScore(
  posting: Pick<FoundPosting, "source" | "externalId">,
  fit: PostingFit,
  scoredWith: string,
  inputFingerprint: string,
): Promise<void> {
  const where = { source_externalId: { source: posting.source, externalId: posting.externalId } };
  const data = {
    score: fit.score,
    reasons: fit.reasons,
    redFlags: fit.redFlags,
    scoredWith,
    meta: fit.meta ?? undefined,
    inputFingerprint,
  };
  await prisma.postingScore.upsert({ where, create: { source: posting.source, externalId: posting.externalId, ...data }, update: data });
}

/** A PostingScore row as PostingFit, with staleness when `currentFingerprint` is passed. */
export function postingFitFromScoreRow(
  row: {
    score: number;
    reasons: Prisma.JsonValue;
    redFlags: Prisma.JsonValue;
    scoredWith: string;
    meta: unknown;
    inputFingerprint: string | null;
  },
  currentFingerprint?: string | null,
): PostingFit {
  return {
    score: row.score,
    reasons: stringsOf(row.reasons),
    redFlags: stringsOf(row.redFlags),
    meta: parsePostingFitMeta(row.meta),
    scoredWith: row.scoredWith || undefined,
    stale: currentFingerprint ? !row.inputFingerprint || row.inputFingerprint !== currentFingerprint : undefined,
  };
}
