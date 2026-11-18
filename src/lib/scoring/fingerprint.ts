import "server-only";

import { createHash } from "node:crypto";

import { MAX_POSTING_CHARACTERS } from "@/lib/ai/tasks/prompt-parts";
import { SCORE_POSTING_VERSION } from "@/lib/ai/tasks/score-posting";

import type { ScoringConfig } from "./config";
import { SCORE_POSTING_DECISIONS_VERSION } from "./decisions";
import { SCORE_POSTING_JEV_VERSION } from "./jev";
import { engineQuestions, scoringState, type ScoringPosting, type ScoringProfile } from "./questions";
import { SCORE_POSTING_OPENROUTER_DECISIONS_VERSION } from "./versions";

const digest16 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

/** Stable hash of the posting fields the shared factor engine sees. */
export function postingContentHash(posting: ScoringPosting): string {
  return digest16({
    title: posting.title,
    company: posting.company,
    place: posting.place,
    remote: posting.remote,
    salary: posting.salary,
    description: posting.description.trim().slice(0, MAX_POSTING_CHARACTERS),
  });
}

/** Changes when questions, prompts, or scorer-specific policy changes. */
export function scorerPolicyVersion(config: ScoringConfig): string {
  const version =
    config.scorer === "JEV"
      ? SCORE_POSTING_JEV_VERSION
      : config.scorer === "DECISIONS"
        ? SCORE_POSTING_DECISIONS_VERSION
        : config.scorer === "OPENROUTER_DECISIONS"
          ? SCORE_POSTING_OPENROUTER_DECISIONS_VERSION
          : SCORE_POSTING_VERSION;
  return digest16({ scorer: config.scorer, version, questions: engineQuestions([]) });
}

/** Fingerprint for cached scores: profile sections, levels, workplace, work authorization, scorer policy, posting and reference day. */
export function scoreInputFingerprint(
  profile: ScoringProfile,
  posting: ScoringPosting,
  config: ScoringConfig,
  referenceDate: Date,
): string {
  const state = scoringState(posting, profile, referenceDate);
  return digest16({
    profile: state.candidate,
    referenceDate: referenceDate.toISOString().slice(0, 10),
    scorer: config.scorer,
    model: config.scorer === "OPENROUTER" || config.scorer === "OPENROUTER_DECISIONS" ? config.openrouterModel : null,
    policy: scorerPolicyVersion(config),
    posting: postingContentHash(posting),
  });
}
