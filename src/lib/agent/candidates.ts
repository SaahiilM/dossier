import { createHash } from "node:crypto";

import type { AgentCandidate, Prisma } from "@/generated/prisma/client";
import { linkKey, type FoundPosting } from "@/lib/job-search/search";
import { parsePostingFitMeta, type PostingFit } from "@/lib/fit";
import type { ScoringConfig } from "@/lib/scoring/config";
import { scoreInputFingerprint } from "@/lib/scoring/fingerprint";
import type { ScoringProfile } from "@/lib/scoring/questions";
import { coverageOf, type Coverage } from "@/lib/posting-coverage";

// The job agent's candidates (E16): postings it found and scored. A dismissed
// one stays, so the posting never comes back, but keeps only what dedupe
// needs.

/** Lower case, letters and digits only, accents dropped: "Café  GmbH" and "cafe gmbh" are the same. */
const normal = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * The dedupe key: a hash of the link without tracking parameters, else of
 * company, title and place, so the same job found through another source or
 * in a later run matches. A posting with none of those falls back to its
 * source's id.
 */
export function agentDedupeKey(posting: Pick<FoundPosting, "source" | "externalId" | "url" | "title" | "company" | "place">): string {
  const link = linkKey(posting.url);
  const facts = [posting.company, posting.title, posting.place].map(normal);
  const basis = link ? `link:${link}` : facts.some(Boolean) ? `job:${facts.join("|")}` : `id:${posting.source}:${posting.externalId}`;
  return createHash("sha256").update(basis).digest("hex");
}

/** A posting as a new candidate, with its score and provenance. */
export function candidateData(
  posting: FoundPosting,
  fit: Pick<PostingFit, "score" | "reasons" | "redFlags" | "meta" | "breakdown">,
  scoredWith = "",
  inputFingerprint: string | null = null,
): Prisma.AgentCandidateCreateInput {
  const coverage = coverageOf(fit);
  return {
    source: posting.source,
    externalId: posting.externalId,
    title: posting.title,
    company: posting.company,
    place: posting.place,
    remote: posting.remote,
    salary: posting.salary,
    postedAt: posting.postedAt ? new Date(posting.postedAt) : null,
    url: posting.url,
    via: posting.via,
    description: posting.description,
    complete: posting.complete,
    score: fit.score,
    reasons: fit.reasons,
    redFlags: fit.redFlags,
    meta: fit.meta ? (fit.meta as Prisma.InputJsonValue) : undefined,
    scoredWith,
    inputFingerprint,
    covered: coverage.hit,
    requirements: coverage.total,
    mustMissing: coverage.mustMissing,
    dedupeKey: agentDedupeKey(posting),
  };
}

type CandidateFitRow = Pick<
  AgentCandidate,
  "score" | "reasons" | "redFlags" | "meta" | "scoredWith" | "inputFingerprint" | "title" | "company" | "place" | "remote" | "salary" | "description"
>;

/** Agent row as PostingFit for freshness and auto-draft checks. */
export function postingFitFromCandidate(
  row: CandidateFitRow,
  profile: ScoringProfile,
  config: ScoringConfig,
  referenceDate: Date,
): PostingFit {
  const posting = {
    title: row.title,
    company: row.company,
    place: row.place,
    remote: row.remote,
    salary: row.salary,
    description: row.description,
  };
  return {
    score: row.score,
    reasons: stringsOf(row.reasons),
    redFlags: stringsOf(row.redFlags),
    meta: parsePostingFitMeta(row.meta),
    scoredWith: row.scoredWith || undefined,
    stale: !row.inputFingerprint || row.inputFingerprint !== scoreInputFingerprint(profile, posting, config, referenceDate),
  };
}

/**
 * What a dismissed candidate gives up (#191): everything but its source, the
 * source's id, its dedupe key, title and company, which say what it was.
 */
export const DISMISSED_TRIM = {
  place: "",
  remote: null,
  salary: "",
  postedAt: null,
  url: "",
  via: "",
  description: "",
  complete: false,
  reasons: [],
  redFlags: [],
  error: null,
  applicationId: null,
} satisfies Prisma.AgentCandidateUncheckedUpdateInput;

/** A JSON list of strings, as reasons and red flags are stored; anything else reads as none. */
export function stringsOf(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** A candidate's coverage, as stored with it. */
export const candidateCoverage = (candidate: { covered: number; requirements: number; mustMissing: number }): Coverage => ({
  hit: candidate.covered,
  total: candidate.requirements,
  mustMissing: candidate.mustMissing,
});

/** Why a run left a posting unscored (E32-5, PL3). Under the cut-off isn't kept: it follows the cut-off as it is now. */
export type SkipReason = "budget" | "known" | "dismissed";

/** A skip as the Skipped tab says it. */
export const SKIP_WORDS: Record<SkipReason, string> = {
  budget: "Past the run's scoring limit: it stays in Positions unscored",
  known: "Already in Positions: saved, applied for or archived",
  dismissed: "Dismissed earlier",
};
