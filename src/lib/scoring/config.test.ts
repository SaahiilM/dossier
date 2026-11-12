import { describe, expect, it, vi } from "vitest";

import { encryptSecret, JOB_SOURCE_KEY, OPENROUTER_SCORING_KEY, TYPESAFE_KEY } from "@/lib/secrets";

import { jevKey, openRouterKey, resolveScoringConfig, scoringView } from "./config";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));

const openRouterEmpty = { openRouterScoringModel: null, openRouterScoringKeyEnc: null };
const nothingSaved = { scorer: null, typesafeKeyEnc: null, ...openRouterEmpty };
const orFields = { openRouterModel: "", openRouterKey: null, openRouterKeyState: "none" as const };

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
    expect(scoringView({ scorer: "JEV", saved: true, key: "ts_secret", keyState: "set", openRouterModel: "", openRouterKey: null, openRouterKeyState: "none" })).toEqual({
      scorer: "JEV",
      keyState: "set",
      openRouterKeyState: "none",
      openRouterModel: "",
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
