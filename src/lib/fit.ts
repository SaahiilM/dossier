import { z } from "zod";

import { addUp, FACTORS, fitLines, type Breakdown, type FactorAnswers } from "@/lib/scoring/factors";

// How well a posting fits a profile (#208, E16-2, E25): a score, with why.
// Shared by Positions, New application and the Agent screen. A score from the
// engine (E25) has its breakdown, one written in Claude chat too; one from
// before it has only its reasons and red flags.

export type PostingFit = {
  score: number;
  reasons: string[];
  redFlags: string[];
  /** How it adds up (E25-6); null for a score without one. */
  breakdown?: Breakdown | null;
  meta?: PostingFitMeta;
  scoredWith?: string;
  stale?: boolean;
};

/** A scoring model's answers, added up (E25-1), with the breakdown also as plain lines. */
export function fitFromAnswers(answers: FactorAnswers): PostingFit {
  const { score, breakdown } = addUp(answers);
  return { score, ...fitLines(breakdown), breakdown, meta: metaFromAnswers(answers) };
}

const factorIds = FACTORS.map((factor) => factor.id) as [Breakdown["factors"][number]["factor"], ...Breakdown["factors"][number]["factor"][]];

/** A stored breakdown (PostingScore.breakdown), or null for anything else. */
export const breakdownSchema = z.object({
  factors: z.array(z.object({ factor: z.enum(factorIds), points: z.number(), max: z.number(), reason: z.string() })),
  cap: z.object({ at: z.number(), reason: z.string() }).nullable(),
  requirements: z.array(z.object({ text: z.string(), mustHave: z.boolean(), covered: z.boolean(), evidence: z.string().nullable(), skill: z.string().nullable().optional() })),
});

export const breakdownOf = (stored: unknown): Breakdown | null => breakdownSchema.nullable().catch(null).parse(stored ?? null);

/** What scored it before the engine (E25): the AI model's score-posting@1 or @2, or Jev's first version. */
export const isOlderScore = (scoredWith: string) => /^(score-posting@[12]|score-posting-jev@1|score-posting-openrouter-decisions@[123])\b/.test(scoredWith);

export type PostingFitReview = "eligible" | "ineligible" | "needs_review";

export type PostingFitIssue = "missing_required" | "location_permit" | "language" | "seniority_gap" | "thin_posting" | "uncertain";

export const postingFitMetaSchema = z.object({
  review: z.enum(["eligible", "ineligible", "needs_review"]),
  blockAutoDraft: z.boolean(),
  issues: z
    .array(z.enum(["missing_required", "location_permit", "language", "seniority_gap", "thin_posting", "uncertain"]))
    .optional(),
});

export type PostingFitMeta = z.infer<typeof postingFitMetaSchema>;

/** Eligibility from the shared factor answers: any hard mismatch or uncertainty blocks agent auto-draft. */
export function metaFromAnswers(answers: FactorAnswers): PostingFitMeta {
  const issues: PostingFitIssue[] = [];
  if (answers.requirements.some((requirement) => requirement.mustHave && !requirement.covered)) issues.push("missing_required");
  if (answers.location.fit === "cannot") issues.push("location_permit");
  if (answers.seniority.fit === "far-above" || answers.seniority.fit === "far-below") issues.push("seniority_gap");
  if (answers.thin) issues.push("thin_posting");

  const uncertain = answers.location.fit === "stretch" || answers.seniority.fit === "above" || answers.seniority.fit === "below";
  if (uncertain) issues.push("uncertain");
  const hardIssue = issues.some((issue) => issue !== "uncertain");
  const review: PostingFitReview = hardIssue ? "ineligible" : uncertain ? "needs_review" : "eligible";
  return { review, blockAutoDraft: review !== "eligible", ...(issues.length > 0 ? { issues } : {}) };
}

export function parsePostingFitMeta(value: unknown): PostingFitMeta | undefined {
  const parsed = postingFitMetaSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** AI chat scorer: conservative meta from red flags only (no Jev parts). */
export function chatScoreMeta(answer: Pick<PostingFit, "redFlags" | "score">): PostingFitMeta {
  const hard = answer.redFlags.length > 0;
  const review: PostingFitReview = hard ? "needs_review" : answer.score >= 70 ? "eligible" : "needs_review";
  return { review, blockAutoDraft: hard || review !== "eligible" };
}

/** Whether auto-draft must stay off; uses persisted meta and staleness, not score alone. */
export function fitAutoDraftBlocked(fit: PostingFit): boolean {
  if (fit.stale) return true;
  if (!fit.meta) return true;
  if (fit.meta.blockAutoDraft || fit.meta.review !== "eligible") return true;
  if (fit.breakdown?.cap) return true;
  return Boolean(fit.breakdown?.requirements.some((requirement) => requirement.mustHave && !requirement.covered));
}

