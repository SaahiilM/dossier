// How well a posting fits the profile (#208, E16-2): a score from
// score-posting, with why. Shared by Find jobs and the Agent screen.

import { z } from "zod";

import type { PostingScore } from "@/lib/ai/tasks/score-posting";

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

export type PostingFit = {
  score: number;
  reasons: string[];
  redFlags: string[];
  meta?: PostingFitMeta;
  /** What scored it; shown when stale or for audit. */
  scoredWith?: string;
  /** True when the saved fingerprint no longer matches the current profile or scorer. */
  stale?: boolean;
};

export function parsePostingFitMeta(value: unknown): PostingFitMeta | undefined {
  const parsed = postingFitMetaSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** AI chat scorer: conservative meta from red flags only (no Jev parts). */
export function chatScoreMeta(answer: PostingScore): PostingFitMeta {
  const hard = answer.redFlags.length > 0;
  const review: PostingFitReview = hard ? "needs_review" : answer.score >= 70 ? "eligible" : "needs_review";
  return { review, blockAutoDraft: hard || review !== "eligible" };
}

/** Whether auto-draft must stay off; uses persisted meta and staleness, not score alone. */
export function fitAutoDraftBlocked(fit: PostingFit): boolean {
  if (fit.stale) return true;
  if (!fit.meta) return true;
  return fit.meta.blockAutoDraft;
}

/** The score's band, as the prompt defines them: "Good fit". */
export function fitBand(score: number): string {
  if (score >= 85) return "Excellent fit";
  if (score >= 70) return "Good fit";
  if (score >= 50) return "Possible fit";
  return "Poor fit";
}
