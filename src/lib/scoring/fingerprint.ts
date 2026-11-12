import "server-only";

import { createHash } from "node:crypto";

import { profileForPrompt } from "@/lib/ai/tasks/prompt-parts";
import { SCORE_POSTING_VERSION } from "@/lib/ai/tasks/score-posting";
import type { ProfileData } from "@/lib/profile";
import { workAuthorizationForScorer } from "@/lib/work-authorization";

import type { ScoringConfig } from "./config";
import { JEV_WEIGHTS, jevPostingText, jevQuestions, SCORE_POSTING_JEV_VERSION } from "./jev";
import { SCORE_POSTING_OPENROUTER_DECISIONS_VERSION, SCORE_POSTING_OPENROUTER_VERSION } from "./versions";
import type { ScorablePosting } from "./index";

const digest16 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

/** Stable hash of the posting fields Jev uses when scoring. */
export function postingContentHash(posting: ScorablePosting): string {
  return digest16({
    title: posting.title,
    company: posting.company,
    place: posting.place,
    remote: posting.remote,
    salary: posting.salary,
    description: jevPostingText(posting.description),
  });
}

/** Changes when questions, weights, or prompt versions change. */
export function scorerPolicyVersion(config: ScoringConfig): string {
  const hash = (payload: unknown) => createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 12);
  if (config.scorer === "JEV") return hash({ v: SCORE_POSTING_JEV_VERSION, q: jevQuestions([]), w: JEV_WEIGHTS });
  if (config.scorer === "OPENROUTER_DECISIONS") {
    return hash({ v: SCORE_POSTING_OPENROUTER_DECISIONS_VERSION, q: jevQuestions([]), w: JEV_WEIGHTS, m: config.openRouterModel });
  }
  if (config.scorer === "OPENROUTER") return hash({ v: SCORE_POSTING_OPENROUTER_VERSION, m: config.openRouterModel });
  return hash({ v: SCORE_POSTING_VERSION });
}

/** Fingerprint for cache staleness: profile, work auth, scorer policy, posting, reference date. */
export function scoreInputFingerprint(
  profile: ProfileData,
  posting: ScorablePosting,
  config: ScoringConfig,
  referenceDate: Date,
): string {
  return digest16({
    profile: JSON.parse(profileForPrompt(profile)),
    workAuthorization: workAuthorizationForScorer(profile.workAuthorization),
    referenceDate: referenceDate.toISOString().slice(0, 10),
    scorer: config.scorer,
    model:
      config.scorer === "OPENROUTER" || config.scorer === "OPENROUTER_DECISIONS"
        ? config.openRouterModel || null
        : null,
    policy: scorerPolicyVersion(config),
    posting: postingContentHash(posting),
  });
}
