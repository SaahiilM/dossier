import { describe, expect, it } from "vitest";

import { OPENROUTER_DECISION_MODEL } from "./scorers";

// One free decisions request. Skipped unless asked for:
//
//   OPENROUTER_DECISIONS_LIVE=check yarn vitest run src/lib/scoring/openrouter-decisions.live.test.ts
//
// Uses DOSSIER_OPENROUTER_SCORING_KEY. The key is never printed.

const live = process.env.OPENROUTER_DECISIONS_LIVE === "check";

describe.skipIf(!live)("OpenRouter decision connection", () => {
  it("gets an answer from the free decision model", async () => {
    process.loadEnvFile(".env");
    const { openRouterDecisionTarget, loadScoringConfig } = await import("./config");
    const { probeOpenRouterDecision } = await import("./openrouter-decisions");
    const decision = openRouterDecisionTarget(await loadScoringConfig());
    if (decision.problem !== null) throw new Error(decision.problem);
    const result = await probeOpenRouterDecision(decision.key, decision.model || OPENROUTER_DECISION_MODEL, { timeoutMs: 60_000 });
    expect(result.model.length).toBeGreaterThan(0);
    expect(result.usage.costUsd === null || result.usage.costUsd === 0).toBe(true);
    expect(result.answers.ready?.type).toBe("noul");
  });
});
