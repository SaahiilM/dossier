// What can score postings (#274): the AI model in Settings → AI provider,
// or TypeSafe's Jev. Shared by the server and Settings → Scoring.

export const SCORERS = ["AI", "JEV", "OPENROUTER"] as const;
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
  OPENROUTER: {
    name: "OpenRouter model",
    description: "A separately configured OpenRouter model scores postings and explains its assessment.",
    tag: "Needs an OpenRouter key and judging model",
  },
};

export const TYPESAFE_KEY_URL = "https://console.typesafe.ai/keys";

export const SCORING_KEY_MISSING = "Enter your TypeSafe key in Settings → Scoring first.";
export const SCORING_KEY_UNREADABLE = "Your saved TypeSafe key can't be read. Enter it again in Settings → Scoring.";

export const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys";

export const OPENROUTER_SCORING_KEY_MISSING = "Enter your OpenRouter key in Settings → Scoring first.";
export const OPENROUTER_SCORING_KEY_UNREADABLE = "Your saved OpenRouter key can't be read. Enter it again in Settings → Scoring.";
export const OPENROUTER_SCORING_MODEL_MISSING = "Choose an OpenRouter judging model in Settings → Scoring first.";
