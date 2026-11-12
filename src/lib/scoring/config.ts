import "server-only";

import { env, type Env } from "@/lib/env";
import { decryptSecret, SecretUnreadable, TYPESAFE_KEY, OPENROUTER_SCORING_KEY } from "@/lib/secrets";
import type { SettingsData } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";

import {
  OPENROUTER_DECISION_MODEL,
  OPENROUTER_SCORING_KEY_MISSING,
  OPENROUTER_SCORING_KEY_UNREADABLE,
  OPENROUTER_SCORING_MODEL_MISSING,
  SCORING_KEY_MISSING,
  SCORING_KEY_UNREADABLE,
  type Scorer,
  type ScoringKeyState,
  type ScoringView,
} from "./scorers";

// What scores postings (#274): the choice saved in Settings → Scoring, or
// else DOSSIER_SCORER, or else the AI model; and Jev's key, saved there or
// in DOSSIER_TYPESAFE_KEY.

export type ScoringConfig = {
  scorer: Scorer;
  /** Whether the choice is saved in Settings, rather than coming from DOSSIER_SCORER or the default. */
  saved: boolean;
  key: string | null;
  keyState: ScoringKeyState;
  openRouterModel: string;
  openRouterKey: string | null;
  openRouterKeyState: ScoringKeyState;
  /** `OPENROUTER_API_KEY` only when DOSSIER_OPENROUTER_SCORING_KEY_SOURCE is openrouter_api_key and the scoring key is unset. */
  openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY" | "OPENROUTER_API_KEY";
};

const FROM_ENV: Record<NonNullable<Env["DOSSIER_SCORER"]>, Scorer> = {
  ai: "AI",
  jev: "JEV",
  openrouter: "OPENROUTER",
  "openrouter-decisions": "OPENROUTER_DECISIONS",
};

export function resolveScoringConfig(
  saved: Pick<SettingsData, "scorer" | "typesafeKeyEnc" | "openRouterScoringModel" | "openRouterScoringKeyEnc">,
  source: Pick<
    Env,
    | "DOSSIER_SCORER"
    | "DOSSIER_TYPESAFE_KEY"
    | "DOSSIER_OPENROUTER_SCORING_KEY"
    | "DOSSIER_OPENROUTER_SCORING_MODEL"
    | "DOSSIER_OPENROUTER_SCORING_KEY_SOURCE"
    | "OPENROUTER_API_KEY"
  >,
  secret?: string,
): ScoringConfig {
  const scorer = saved.scorer ?? (source.DOSSIER_SCORER ? FROM_ENV[source.DOSSIER_SCORER] : "AI");
  const choice = { scorer, saved: saved.scorer !== null };
  const requestedModel = (saved.openRouterScoringModel || source.DOSSIER_OPENROUTER_SCORING_MODEL || "").trim();
  const openRouterModel = scorer === "OPENROUTER_DECISIONS" && requestedModel === "" ? OPENROUTER_DECISION_MODEL : requestedModel;
  let openRouterKey: string | null = null;
  let openRouterKeyState: ScoringKeyState = "none";
  let openRouterKeyEnv: ScoringConfig["openRouterKeyEnv"] = "DOSSIER_OPENROUTER_SCORING_KEY";
  if (saved.openRouterScoringKeyEnc) {
    try { openRouterKey = decryptSecret(OPENROUTER_SCORING_KEY, saved.openRouterScoringKeyEnc, secret); openRouterKeyState = "set"; }
    catch (error) { if (!(error instanceof SecretUnreadable)) throw error; openRouterKeyState = "unreadable"; }
  } else if (source.DOSSIER_OPENROUTER_SCORING_KEY) {
    openRouterKey = source.DOSSIER_OPENROUTER_SCORING_KEY;
    openRouterKeyState = "env";
  } else if (source.DOSSIER_OPENROUTER_SCORING_KEY_SOURCE === "openrouter_api_key" && source.OPENROUTER_API_KEY) {
    // Explicit opt-in only. A general OpenRouter key is not a scoring key by itself.
    openRouterKey = source.OPENROUTER_API_KEY;
    openRouterKeyState = "env";
    openRouterKeyEnv = "OPENROUTER_API_KEY";
  }
  if (saved.typesafeKeyEnc) {
    try {
      return { ...choice, key: decryptSecret(TYPESAFE_KEY, saved.typesafeKeyEnc, secret), keyState: "set", openRouterModel, openRouterKey, openRouterKeyState, openRouterKeyEnv };
    } catch (error) {
      if (!(error instanceof SecretUnreadable)) throw error;
      return { ...choice, key: null, keyState: "unreadable", openRouterModel, openRouterKey, openRouterKeyState, openRouterKeyEnv };
    }
  }
  const jev = source.DOSSIER_TYPESAFE_KEY ? { key: source.DOSSIER_TYPESAFE_KEY, keyState: "env" as const } : { key: null, keyState: "none" as const };
  return { ...choice, ...jev, openRouterModel, openRouterKey, openRouterKeyState, openRouterKeyEnv };
}

/** The scoring configuration in effect right now. */
export async function loadScoringConfig(): Promise<ScoringConfig> {
  return resolveScoringConfig(await loadSettings(), env);
}

export const scoringView = (config: ScoringConfig): ScoringView => ({
  scorer: config.scorer,
  keyState: config.keyState,
  openRouterKeyState: config.openRouterKeyState,
  openRouterModel: config.openRouterModel,
  openRouterKeyEnv: config.openRouterKeyEnv,
});

/** Jev's key, or why there isn't one, in words. */
export function jevKey({ key, keyState }: Pick<ScoringConfig, "key" | "keyState">): { key: string; problem: null } | { key: null; problem: string } {
  if (key) return { key, problem: null };
  return { key: null, problem: keyState === "unreadable" ? SCORING_KEY_UNREADABLE : SCORING_KEY_MISSING };
}

/** OpenRouter judging key, or why it can't be used. */
export function openRouterKey({
  openRouterKey,
  openRouterKeyState,
  openRouterModel,
}: Pick<ScoringConfig, "openRouterKey" | "openRouterKeyState" | "openRouterModel">):
  | { key: string; model: string; problem: null }
  | { key: null; model: null; problem: string } {
  if (!openRouterModel) return { key: null, model: null, problem: OPENROUTER_SCORING_MODEL_MISSING };
  if (!openRouterKey) {
    return { key: null, model: null, problem: openRouterKeyState === "unreadable" ? OPENROUTER_SCORING_KEY_UNREADABLE : OPENROUTER_SCORING_KEY_MISSING };
  }
  return { key: openRouterKey, model: openRouterModel, problem: null };
}

/** OpenRouter decision key and model. An empty model uses the free default. */
export function openRouterDecisionTarget({
  openRouterKey,
  openRouterKeyState,
  openRouterModel,
}: Pick<ScoringConfig, "openRouterKey" | "openRouterKeyState" | "openRouterModel">):
  | { key: string; model: string; problem: null }
  | { key: null; model: null; problem: string } {
  if (!openRouterKey) {
    return { key: null, model: null, problem: openRouterKeyState === "unreadable" ? OPENROUTER_SCORING_KEY_UNREADABLE : OPENROUTER_SCORING_KEY_MISSING };
  }
  return { key: openRouterKey, model: openRouterModel.trim() || OPENROUTER_DECISION_MODEL, problem: null };
}
