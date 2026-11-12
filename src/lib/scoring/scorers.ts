// What can score postings (#274): the AI model, Jev, an OpenRouter decision
// model, or an OpenRouter chat model. Shared by the server and Settings → Scoring.

export const SCORERS = ["AI", "JEV", "OPENROUTER_DECISIONS", "OPENROUTER"] as const;
export type Scorer = (typeof SCORERS)[number];

/** Like the job sources' keys: saved here, from DOSSIER_TYPESAFE_KEY, missing, or saved under another DOSSIER_SECRET. */
export type ScoringKeyState = "none" | "set" | "unreadable" | "env";

/** What Settings → Scoring shows: the choice and key states, never the keys. */
export type ScoringView = {
  scorer: Scorer;
  /** TypeSafe key, when Jev is relevant. */
  keyState: ScoringKeyState;
  openRouterKeyState: ScoringKeyState;
  openRouterModel: string;
  /** Which environment variable supplies the OpenRouter scoring key, when that key comes from the environment. */
  openRouterKeyEnv?: "DOSSIER_OPENROUTER_SCORING_KEY" | "OPENROUTER_API_KEY";
};

export const SCORER_INFO: Record<Scorer, { name: string; description: string; tag: string }> = {
  AI: {
    name: "Your AI model",
    description: "The AI provider in Settings → AI provider scores each posting and writes why it fits, in its own words.",
    tag: "Uses your AI provider",
  },
  JEV: {
    name: "Jev by TypeSafe",
    description: "A model made for quick judgments. It answers questions about the posting, and Dossier builds the score and the reasons from the posting's own lines.",
    tag: "Needs a TypeSafe key",
  },
  OPENROUTER_DECISIONS: {
    name: "OpenRouter decision model",
    description: "A free OpenRouter decision model answers the same questions as Jev. Dossier builds the score from those answers and quotes the posting's own lines. It writes no prose.",
    tag: "Default perplexity/pplx-decider-v1.3:free",
  },
  OPENROUTER: {
    name: "OpenRouter chat model",
    description: "A separately configured OpenRouter chat model scores postings and writes its own explanation.",
    tag: "Needs an OpenRouter key and a chat model",
  },
};

/** The free decision model Settings offers when OpenRouter decision scoring is chosen. */
export const OPENROUTER_DECISION_MODEL = "perplexity/pplx-decider-v1.3:free";

/**
 * The model saved with a switch to decision scoring. A model id that does not
 * end in `:free` is replaced by the free default. A `:free` id is kept.
 */
export function decisionModelOnSelect(current: string | null, scorer: Scorer): string | undefined {
  if (scorer !== "OPENROUTER_DECISIONS") return undefined;
  const model = current?.trim() ?? "";
  if (model.endsWith(":free")) return undefined;
  return OPENROUTER_DECISION_MODEL;
}

export const TYPESAFE_KEY_URL = "https://console.typesafe.ai/keys";

export const SCORING_KEY_MISSING = "Enter your TypeSafe key in Settings → Scoring first.";
export const SCORING_KEY_UNREADABLE = "Your saved TypeSafe key can't be read. Enter it again in Settings → Scoring.";

export const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys";

export const OPENROUTER_SCORING_KEY_MISSING = "Enter your OpenRouter key in Settings → Scoring first.";
export const OPENROUTER_SCORING_KEY_UNREADABLE = "Your saved OpenRouter key can't be read. Enter it again in Settings → Scoring.";
export const OPENROUTER_SCORING_MODEL_MISSING = "Choose an OpenRouter judging model in Settings → Scoring first.";
