import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiError } from "@/lib/ai/errors";
import { MockProvider } from "@/lib/ai/providers/mock";
import { demoProfile } from "@/lib/demo-profile";

import type { ScoringConfig } from "./config";
import { loadPostingScorer, scoringProblem } from "./index";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));

const state = vi.hoisted(() => ({
  config: { scorer: "AI", saved: false, key: null, keyState: "none", openRouterModel: "", openRouterKey: null, openRouterKeyState: "none", openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY" } as ScoringConfig,
  aiReady: true,
  provider: null as unknown,
}));

vi.mock("./config", async (importOriginal) => ({ ...(await importOriginal<typeof import("./config")>()), loadScoringConfig: async () => state.config }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => state.aiReady }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => state.provider }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: true, language: null }) }));
vi.mock("@/lib/usage-data", () => ({ recordUsage: vi.fn() }));
vi.mock("./jev", () => ({
  scoreWithJev: vi.fn(async () => ({
    data: { score: 80, reasons: ["Covers: Figma"], redFlags: [], meta: { review: "eligible", blockAutoDraft: false } },
    scoredWith: "score-posting-jev@3 (jev-1.14.0)",
  })),
}));
vi.mock("./openrouter", () => ({
  scoreWithOpenRouter: vi.fn(async () => ({
    data: { score: 76, reasons: ["Knows Figma."], redFlags: [] },
    scoredWith: "score-posting-openrouter@1 (openai/gpt-4.1-mini)",
  })),
}));
vi.mock("./openrouter-decisions", () => ({
  scoreWithOpenRouterDecisions: vi.fn(async () => ({
    data: { score: 81, reasons: ["Covers: Figma"], redFlags: [], meta: { review: "eligible", blockAutoDraft: false } },
    scoredWith: "score-posting-openrouter-decisions@3 (perplexity/pplx-decider-v1.3-20261112) costUsd=0",
  })),
}));

const { scoreWithJev } = await import("./jev");
const { recordUsage } = await import("@/lib/usage-data");

const profile = demoProfile();
const posting = { title: "Designer", company: "Ledgerly", place: "Amsterdam", remote: false, salary: "", description: "You know Figma." };
const signal = new AbortController().signal;

const { scoreWithOpenRouter } = await import("./openrouter");
const { scoreWithOpenRouterDecisions } = await import("./openrouter-decisions");

beforeEach(() => {
  state.config = { scorer: "AI", saved: false, key: null, keyState: "none", openRouterModel: "", openRouterKey: null, openRouterKeyState: "none", openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY" };
  state.aiReady = true;
  vi.mocked(scoreWithJev).mockClear();
  vi.mocked(scoreWithOpenRouter).mockClear();
  vi.mocked(scoreWithOpenRouterDecisions).mockClear();
});

describe("scoringProblem (#274)", () => {
  it("asks for an AI provider, or for Jev's key, whichever scores", async () => {
    expect(await scoringProblem()).toBeNull();
    state.aiReady = false;
    expect(await scoringProblem()).toBe("Choose an AI provider in Settings → AI provider first.");

    state.config = { scorer: "JEV", saved: true, key: null, keyState: "none", openRouterModel: "", openRouterKey: null, openRouterKeyState: "none", openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY" };
    expect(await scoringProblem()).toBe("Enter your TypeSafe key in Settings → Scoring first.");
    expect(await scoringProblem({ ...state.config, key: "ts", keyState: "set" })).toBeNull();

    state.config = { scorer: "OPENROUTER", saved: true, key: null, keyState: "none", openRouterModel: "", openRouterKey: null, openRouterKeyState: "none", openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY" };
    expect(await scoringProblem()).toMatch(/model/i);
    state.config = { ...state.config, openRouterModel: "openai/gpt-4.1-mini" };
    expect(await scoringProblem()).toMatch(/OpenRouter key/i);
    expect(await scoringProblem({ ...state.config, openRouterKey: "sk-or", openRouterKeyState: "set", openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY" })).toBeNull();

    state.config = { scorer: "OPENROUTER_DECISIONS", saved: true, key: null, keyState: "none", openRouterModel: "", openRouterKey: null, openRouterKeyState: "none", openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY" };
    expect(await scoringProblem()).toMatch(/OpenRouter key/i);
    expect(await scoringProblem({ ...state.config, openRouterKey: "sk-or", openRouterKeyState: "set", openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY" })).toBeNull();
  });
});

describe("loadPostingScorer", () => {
  it("scores with Jev and its key once chosen, without the AI provider", async () => {
    state.config = { scorer: "JEV", saved: true, key: "ts", keyState: "set", openRouterModel: "", openRouterKey: null, openRouterKeyState: "none", openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY" };
    state.aiReady = false;
    const score = await loadPostingScorer();
    expect(await score(posting, profile, signal)).toEqual({
      data: { score: 80, reasons: ["Covers: Figma"], redFlags: [], meta: { review: "eligible", blockAutoDraft: false } },
      scoredWith: "score-posting-jev@3 (jev-1.14.0)",
    });
    // Jev's tokens go to the Usage screen (#290).
    expect(scoreWithJev).toHaveBeenCalledWith(posting, profile, { key: "ts", signal, onUsage: recordUsage });
  });

  it("scores with the AI model's score-posting otherwise, keeping its prompt version", async () => {
    const provider = new MockProvider({ reply: () => ({ score: 72, reasons: ["Knows Figma."], redFlags: [] }) });
    state.provider = provider;
    const score = await loadPostingScorer();
    expect(await score(posting, profile, signal)).toEqual({
      data: { score: 72, reasons: ["Knows Figma."], redFlags: [], meta: { review: "eligible", blockAutoDraft: false } },
      scoredWith: "score-posting@2",
    });
    expect(provider.calls[0].messages[0].content).toContain("Ledgerly: Designer");
    expect(scoreWithJev).not.toHaveBeenCalled();
  });

  it("fails with what's missing", async () => {
    state.aiReady = false;
    await expect(loadPostingScorer()).rejects.toThrow(new AiError("config", "Choose an AI provider in Settings → AI provider first."));
    state.config = { scorer: "JEV", saved: true, key: null, keyState: "unreadable", openRouterModel: "", openRouterKey: null, openRouterKeyState: "none", openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY" };
    await expect(loadPostingScorer()).rejects.toThrow("Your saved TypeSafe key can't be read. Enter it again in Settings → Scoring.");

    state.config = {
      scorer: "OPENROUTER",
      saved: true,
      key: null,
      keyState: "none",
      openRouterModel: "openai/gpt-4.1-mini",
      openRouterKey: "sk-or",
      openRouterKeyState: "set", openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY",
    };
    state.aiReady = false;
    const orScore = await loadPostingScorer();
    expect(await orScore(posting, profile, signal)).toEqual({
      data: { score: 76, reasons: ["Knows Figma."], redFlags: [], meta: { review: "eligible", blockAutoDraft: false } },
      scoredWith: "score-posting-openrouter@1 (openai/gpt-4.1-mini)",
    });
    expect(scoreWithOpenRouter).toHaveBeenCalledWith(posting, profile, expect.objectContaining({ key: "sk-or", model: "openai/gpt-4.1-mini", onUsage: recordUsage }));
  });

  it("scores with the OpenRouter decision model and the free default when no model is saved", async () => {
    state.config = {
      scorer: "OPENROUTER_DECISIONS",
      saved: true,
      key: null,
      keyState: "none",
      openRouterModel: "",
      openRouterKey: "sk-or",
      openRouterKeyState: "set", openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY",
    };
    state.aiReady = false;
    const score = await loadPostingScorer();
    expect(await score(posting, profile, signal)).toEqual({
      data: { score: 81, reasons: ["Covers: Figma"], redFlags: [], meta: { review: "eligible", blockAutoDraft: false } },
      scoredWith: "score-posting-openrouter-decisions@3 (perplexity/pplx-decider-v1.3-20261112) costUsd=0",
    });
    expect(scoreWithOpenRouterDecisions).toHaveBeenCalledWith(
      posting,
      profile,
      expect.objectContaining({ key: "sk-or", model: "perplexity/pplx-decider-v1.3:free", signal, onUsage: recordUsage }),
    );
    expect(scoreWithJev).not.toHaveBeenCalled();
    expect(scoreWithOpenRouter).not.toHaveBeenCalled();
  });
});
