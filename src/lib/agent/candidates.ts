import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { parsePostingFitMeta, type PostingFit } from "@/lib/fit";
import { linkKey, type FoundPosting } from "@/lib/job-search/search";
import type { ScoringConfig } from "@/lib/scoring/config";
import { scoreInputFingerprint } from "@/lib/scoring/fingerprint";
import type { ProfileData } from "@/lib/profile";

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
type CandidateScore = Pick<PostingFit, "score" | "reasons" | "redFlags" | "meta">;

export function candidateData(
  posting: FoundPosting,
  fit: CandidateScore,
  scoredWith = "",
  inputFingerprint: string | null = null,
): Prisma.AgentCandidateCreateInput {
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
    meta: fit.meta ?? undefined,
    scoredWith,
    inputFingerprint,
    dedupeKey: agentDedupeKey(posting),
  };
}

type CandidateFitRow = {
  score: number;
  reasons: Prisma.JsonValue | null;
  redFlags: Prisma.JsonValue | null;
  meta?: Prisma.JsonValue | null;
  scoredWith?: string | null;
  inputFingerprint?: string | null;
  title: string;
  company: string;
  place: string;
  remote: boolean | null;
  salary: string;
  description: string;
};

/** Agent row as PostingFit for auto-draft and UI. */
export function postingFitFromCandidate(
  row: CandidateFitRow,
  profile: ProfileData,
  config: ScoringConfig,
  referenceDate: Date,
): PostingFit {
  const fingerprint = scoreInputFingerprint(
    profile,
    {
      title: row.title,
      company: row.company,
      place: row.place,
      remote: row.remote,
      salary: row.salary,
      description: row.description,
    },
    config,
    referenceDate,
  );
  return {
    score: row.score,
    reasons: stringsOf(row.reasons),
    redFlags: stringsOf(row.redFlags),
    meta: parsePostingFitMeta(row.meta),
    scoredWith: row.scoredWith || undefined,
    stale: !row.inputFingerprint || row.inputFingerprint !== fingerprint,
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
