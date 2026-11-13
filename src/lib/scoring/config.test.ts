import { describe, expect, it, vi } from "vitest";

import { encryptSecret, JOB_SOURCE_KEY, OPENROUTER_SCORING_KEY, TYPESAFE_KEY } from "@/lib/secrets";

import { OPENROUTER_DECISION_MODEL, decisionModelOnSelect } from "./scorers";
import { jevKey, openRouterDecisionTarget, openRouterKey, resolveScoringConfig, scoringView } from "./config";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));

const openRouterEmpty = { openRouterScoringModel: null, openRouterScoringKeyEnc: null };
const nothingSaved = { scorer: null, typesafeKeyEnc: null, ...openRouterEmpty };
const orFields = {
  openRouterModel: "",
  openRouterKey: null,
  openRouterKeyState: "none" as const,
  openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY" as const,
};

describe("resolveScoringConfig (#274)", () => {
  it("scores with the AI model until something chooses Jev", () => {
    expect(resolveScoringConfig(nothingSaved, {})).toEqual({ scorer: "AI", saved: false, key: null, keyState: "none", ...orFields });
    expect(resolveScoringConfig(nothingSaved, { DOSSIER_SCORER: "jev", DOSSIER_TYPESAFE_KEY: "ts_env" })).toEqual({
      scorer: "JEV",
      saved: false,
      key: "ts_env",
      keyState: "env",
      ...orFields,
    });
  });

  it("reads OpenRouter judging credentials from settings or the environment", () => {
    const saved = {
      scorer: "OPENROUTER" as const,
      typesafeKeyEnc: null,
      openRouterScoringModel: "openai/gpt-4.1-mini",
      openRouterScoringKeyEnc: encryptSecret(OPENROUTER_SCORING_KEY, "sk-or_saved"),
    };
    expect(resolveScoringConfig(saved, {})).toMatchObject({
      scorer: "OPENROUTER",
      openRouterModel: "openai/gpt-4.1-mini",
      openRouterKey: "sk-or_saved",
      openRouterKeyState: "set",
    });
    expect(
      resolveScoringConfig(nothingSaved, {
        DOSSIER_SCORER: "openrouter",
        DOSSIER_OPENROUTER_SCORING_KEY: "sk-or_env",
        DOSSIER_OPENROUTER_SCORING_MODEL: "google/gemini-2.5-flash",
      }),
    ).toMatchObject({
      scorer: "OPENROUTER",
      openRouterKey: "sk-or_env",
      openRouterKeyState: "env",
      openRouterModel: "google/gemini-2.5-flash",
    });
  });

  it("prefers what's saved in Settings to DOSSIER_SCORER and DOSSIER_TYPESAFE_KEY", () => {
    const saved = { scorer: "AI" as const, typesafeKeyEnc: encryptSecret(TYPESAFE_KEY, "ts_saved"), ...openRouterEmpty };
    expect(resolveScoringConfig(saved, { DOSSIER_SCORER: "jev", DOSSIER_TYPESAFE_KEY: "ts_env" })).toEqual({
      scorer: "AI",
      saved: true,
      key: "ts_saved",
      keyState: "set",
      ...orFields,
    });
  });

  it("calls a key saved under another secret, or for something else, unreadable rather than using the environment's", () => {
    for (const typesafeKeyEnc of [encryptSecret(TYPESAFE_KEY, "ts", "b".repeat(32)), encryptSecret(JOB_SOURCE_KEY, "ak")]) {
      expect(resolveScoringConfig({ scorer: "JEV", typesafeKeyEnc, ...openRouterEmpty }, { DOSSIER_TYPESAFE_KEY: "ts_env" })).toEqual({
        scorer: "JEV",
        saved: true,
        key: null,
        keyState: "unreadable",
        ...orFields,
      });
    }
  });
});

describe("jevKey and scoringView", () => {
  it("gives the key, or says what's missing", () => {
    expect(jevKey({ key: "ts", keyState: "set" })).toEqual({ key: "ts", problem: null });
    expect(jevKey({ key: null, keyState: "none" })).toEqual({ key: null, problem: "Enter your TypeSafe key in Settings → Scoring first." });
    expect(jevKey({ key: null, keyState: "unreadable" })).toEqual({ key: null, problem: "Your saved TypeSafe key can't be read. Enter it again in Settings → Scoring." });
  });

  it("never shows the key", () => {
    expect(scoringView({ scorer: "JEV", saved: true, key: "ts_secret", keyState: "set", openRouterModel: "", openRouterKey: null, openRouterKeyState: "none", openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY" })).toEqual({
      scorer: "JEV",
      keyState: "set",
      openRouterKeyState: "none",
      openRouterModel: "",
      openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY",
    });
  });
});

describe("openRouterKey", () => {
  it("needs a model and key", () => {
    expect(openRouterKey({ openRouterKey: null, openRouterKeyState: "none", openRouterModel: "" }).problem).toMatch(/model/i);
    expect(openRouterKey({ openRouterKey: null, openRouterKeyState: "none", openRouterModel: "openai/gpt-4.1-mini" }).problem).toMatch(/key/i);
    expect(openRouterKey({ openRouterKey: "sk-or", openRouterKeyState: "set", openRouterModel: "openai/gpt-4.1-mini" })).toEqual({
      key: "sk-or",
      model: "openai/gpt-4.1-mini",
      problem: null,
    });
  });
});

describe("OpenRouter decision scoring config", () => {
  it("uses the free decision model when none is saved, and ignores OPENROUTER_API_KEY unless asked", () => {
    expect(resolveScoringConfig(nothingSaved, { OPENROUTER_API_KEY: "sk-or-general" })).toMatchObject({
      scorer: "AI",
      openRouterKey: null,
      openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY",
    });
    expect(
      resolveScoringConfig(nothingSaved, {
        DOSSIER_SCORER: "openrouter-decisions",
        DOSSIER_OPENROUTER_SCORING_KEY: "sk-or-scoring",
      }),
    ).toMatchObject({
      scorer: "OPENROUTER_DECISIONS",
      openRouterModel: OPENROUTER_DECISION_MODEL,
      openRouterKey: "sk-or-scoring",
      openRouterKeyState: "env",
      openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY",
    });
    expect(
      resolveScoringConfig(nothingSaved, {
        DOSSIER_SCORER: "openrouter-decisions",
        DOSSIER_OPENROUTER_SCORING_KEY_SOURCE: "openrouter_api_key",
        OPENROUTER_API_KEY: "sk-or-general",
        DOSSIER_OPENROUTER_SCORING_KEY: "sk-or-scoring",
      }).openRouterKey,
    ).toBe("sk-or-scoring");
    expect(
      resolveScoringConfig(nothingSaved, {
        DOSSIER_OPENROUTER_SCORING_KEY_SOURCE: "openrouter_api_key",
        OPENROUTER_API_KEY: "sk-or-general",
      }),
    ).toMatchObject({ openRouterKey: "sk-or-general", openRouterKeyEnv: "OPENROUTER_API_KEY", openRouterKeyState: "env" });
  });

  it("keeps a saved scoring key ahead of the explicit API key fallback", () => {
    const saved = {
      scorer: "OPENROUTER_DECISIONS" as const,
      typesafeKeyEnc: null,
      openRouterScoringModel: "parallel/decisions-fast:free",
      openRouterScoringKeyEnc: encryptSecret(OPENROUTER_SCORING_KEY, "sk-or-saved"),
    };
    expect(
      resolveScoringConfig(saved, {
        DOSSIER_OPENROUTER_SCORING_KEY_SOURCE: "openrouter_api_key",
        OPENROUTER_API_KEY: "sk-or-general",
        DOSSIER_OPENROUTER_SCORING_MODEL: OPENROUTER_DECISION_MODEL,
      }),
    ).toMatchObject({
      openRouterKey: "sk-or-saved",
      openRouterKeyState: "set",
      openRouterModel: "parallel/decisions-fast:free",
      openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY",
    });
  });

  it("replaces a chat model when decision scoring is selected, and keeps a free id", () => {
    expect(decisionModelOnSelect("openai/gpt-4.1-mini", "OPENROUTER_DECISIONS")).toBe(OPENROUTER_DECISION_MODEL);
    expect(decisionModelOnSelect(null, "OPENROUTER_DECISIONS")).toBe(OPENROUTER_DECISION_MODEL);
    expect(decisionModelOnSelect("parallel/decisions-fast:free", "OPENROUTER_DECISIONS")).toBeUndefined();
    expect(decisionModelOnSelect(null, "OPENROUTER")).toBeUndefined();
    expect(openRouterDecisionTarget({ openRouterKey: "sk-or", openRouterKeyState: "set", openRouterModel: "" })).toEqual({
      key: "sk-or",
      model: OPENROUTER_DECISION_MODEL,
      problem: null,
    });
  });
});
