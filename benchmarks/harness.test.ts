import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { CASES } from "./fixtures/cases.ts";
import {
  DECISIONS_URL,
  ENV_FILE,
  MODEL_ID,
  MODELS,
  POLICY,
  baselineUsdPerMillion,
  buildDryResult,
  compareRuns,
  decide,
  decisionRequest,
  keySource,
  loadEnvFile,
  modelAccepted,
  officialMetrics,
  pairedGates,
  parseCatalog,
  projectCallUsd,
  readKey,
  redactText,
  renderReport,
  runLive,
  smokeBody,
  splitOf,
  summarize,
  validateCorpus,
  BENCHMARK_REFERENCE_DATE,
  toProfile,
  wilson,
} from "./harness.ts";
import { JEV_WEIGHTS, jevParts as partsOf, jevScore as scoreOf } from "../src/lib/scoring/jev.ts";

const score = (value: number, confidence = 0.9) => ({ type: "score" as const, score: value, confidence, probabilities: {} });
const noul = (value: number) => ({ type: "noul" as const, noul: value });
const choice = (value: string) => ({ type: "choice" as const, choice: value, confidence: 0.9, probabilities: { [value]: 0.9 } });

function answers(lines: { kind: string; shown: number }[], overrides: Record<string, unknown> = {}) {
  return {
    requirements: score(4),
    work: score(3),
    seniority: score(3),
    location: noul(0.05),
    permit: noul(0.05),
    language: noul(0.05),
    thin: noul(0.05),
    ...Object.fromEntries(lines.flatMap((line, index) => [[`line${index}Kind`, choice(line.kind)], [`line${index}Shown`, noul(line.shown)]])),
    ...overrides,
  };
}

const catalogList = {
  data: [
    {
      id: MODEL_ID,
      canonical_slug: "perplexity/pplx-decider-v1.3-20261112",
      pricing: { prompt: "0", completion: "0" },
      architecture: { output_modalities: ["decisions"] },
    },
  ],
};
const endpoints = { data: [{ provider_name: "Perplexity", pricing: { prompt: "0", completion: "0" } }] };

describe("corpus", () => {
  it("accepts the labeled fixture set", () => {
    assert.deepEqual(validateCorpus(), []);
    assert.equal(CASES.length, 42);
    assert.equal(ENV_FILE.endsWith("/dossier/.env"), true);
  });

  it("splits dev and heldout without the label", () => {
    assert.equal(splitOf("e01"), "dev");
    assert.equal(splitOf("e03"), "heldout");
    assert.equal(splitOf("e01"), splitOf("e01"));
  });
});

describe("policy", () => {
  it("keeps production weights and fixed thresholds", () => {
    assert.deepEqual(JEV_WEIGHTS, { requirements: 0.5, work: 0.3, seniority: 0.2 });
    assert.equal(POLICY.yes, 0.7);
    assert.equal(POLICY.no, 0.3);
    assert.equal(POLICY.passScore, 75);
    assert.equal(POLICY.fitOnDev, false);
    assert.equal(POLICY.fitOnHeldout, false);
  });

  it("passes a clear match, rejects a location block, and escalates the middle", () => {
    const clearLines = ["4 years of TypeScript"];
    const clear = answers([{ kind: "required", shown: 0.9 }]);
    const clearParts = partsOf(clear, clearLines);
    assert.equal(scoreOf(clearParts), 100);
    assert.equal(decide(clearParts, 100, clear), "pass");

    const blocked = answers([{ kind: "required", shown: 0.9 }], { location: noul(0.9) });
    const blockedParts = partsOf(blocked, clearLines);
    assert.equal(scoreOf(blockedParts), 69);
    assert.equal(decide(blockedParts, 69, blocked), "reject");

    const unsure = answers([{ kind: "required", shown: 0.9 }], { location: noul(0.5) });
    assert.equal(decide(partsOf(unsure, clearLines), 100, unsure), "escalate");

    const thin = answers([{ kind: "required", shown: 0.9 }], { thin: noul(0.8), location: noul(0.95) });
    assert.equal(decide(partsOf(thin, clearLines), 60, thin), "escalate");

    const low = answers([], { requirements: score(0), work: score(0), seniority: score(0) });
    assert.equal(decide(partsOf(low, []), scoreOf(partsOf(low, [])), low), "escalate");

    const soft = answers([], { requirements: score(0, 0.4), work: score(0), seniority: score(0) });
    assert.equal(decide(partsOf(soft, []), 0, soft), "escalate");

    const half = answers([{ kind: "required", shown: 0.9 }], { requirements: score(2) });
    const halfParts = partsOf(half, clearLines);
    assert.equal(scoreOf(halfParts), 75);
    assert.equal(decide(halfParts, 75, half), "escalate");

    const missing = answers([{ kind: "required", shown: 0.1 }]);
    assert.equal(decide(partsOf(missing, clearLines), 100, missing), "escalate");
  });
});

describe("request", () => {
  it("uses the decisions body for every case", () => {
    for (const fixture of CASES) {
      const { body } = decisionRequest(fixture);
      assert.equal(body.model, "perplexity/pplx-decider-v1.3:free");
      assert.equal(body.provider.allow_fallbacks, false);
      assert.equal(Object.hasOwn(body, "messages"), false);
    }
    const smoke = smokeBody();
    assert.equal(smoke.model, MODEL_ID);
    assert.deepEqual(Object.keys(smoke).sort(), ["model", "provider", "questions", "state"]);
  });

  it("pins the snapshot and rejects a substitute id", () => {
    assert.equal(modelAccepted("perplexity/pplx-decider-v1.3:free"), true);
    assert.equal(modelAccepted("perplexity/pplx-decider-v1.3-20261112"), true);
    assert.equal(modelAccepted("perplexity/pplx-decider-flash-v1.3:free"), false);
    assert.equal(modelAccepted("perplexity/pplx-decider-v1.2"), false);
    const jev = MODELS.find((model) => model.id === "typesafe/jev-1.14");
    assert.ok(jev);
    assert.equal(modelAccepted(jev.canonicalSnapshot, jev), true);
    assert.equal(modelAccepted("typesafe/jev-1.13", jev), false);
  });

  it("sends the same state and questions for every model", () => {
    const first = decisionRequest(CASES[0], MODELS[0].id);
    for (const spec of MODELS) {
      const { body } = decisionRequest(CASES[0], spec.id);
      assert.equal(body.model, spec.id);
      assert.equal(body.provider.allow_fallbacks, false);
      assert.deepEqual(body.state, first.body.state);
      assert.deepEqual(body.questions, first.body.questions);
      assert.equal(Object.hasOwn(body, "label"), false);
      assert.equal(Object.hasOwn(body.state, "label"), false);
    }
    assert.deepEqual(
      MODELS.map((model) => model.id),
      ["perplexity/pplx-decider-v1.3:free", "parallel/decisions-fast:free", "typesafe/jev-1.14"],
    );
    assert.equal(MODELS[2].budgetUsd, 0.25);
    assert.equal(MODELS[0].billing, "free");
    assert.equal(MODELS[1].billing, "free");
  });
});

describe("accounting", () => {
  it("keeps measured, estimates, avoidance, and the key apart", () => {
    const secret = "sk-or-v1-test-secret-value";
    const dry = buildDryResult({ OPENROUTER_API_KEY: secret, DOSSIER_OPENROUTER_SCORING_KEY: "sk-or-v1-other-secret" });
    const text = JSON.stringify(dry);
    assert.equal(text.includes(secret), false);
    assert.equal(text.includes("sk-or-v1-other-secret"), false);
    assert.equal(dry.key.variable, "OPENROUTER_API_KEY");
    assert.equal(dry.measured, null);
    assert.equal(dry.baseline.called, false);
    assert.ok(dry.rows.every((row) => row.simulated.kind === "estimate" && row.simulated.decisionTokens > 0));
    assert.equal(keySource({ DOSSIER_OPENROUTER_SCORING_KEY: "sk-or-v1-fallback-secret" }), "DOSSIER_OPENROUTER_SCORING_KEY");
    assert.equal(readKey({ OPENROUTER_API_KEY: "  " , DOSSIER_OPENROUTER_SCORING_KEY: "" }), null);
    assert.equal(baselineUsdPerMillion({}), null);
    assert.equal(redactText(`Bearer ${secret} failed`, [secret]).text.includes(secret), false);
  });

  it("loads a dotenv file into the supplied object", () => {
    const dir = mkdtempSync(join(tmpdir(), "decider-"));
    const path = join(dir, ".env");
    const secret = "sk-or-v1-file-secret-value";
    writeFileSync(path, `OPENROUTER_API_KEY=${secret}\n`);
    const env: Record<string, string | undefined> = {};
    loadEnvFile(path, env);
    assert.equal(env.OPENROUTER_API_KEY, secret);
    assert.equal(JSON.stringify({ variable: keySource(env) }).includes(secret), false);
  });

  it("scores heldout only", () => {
    const metrics = officialMetrics([
      { split: "heldout", label: "eligible", gate: "pass" },
      { split: "heldout", label: "eligible", gate: "reject" },
      { split: "heldout", label: "ineligible", gate: "reject" },
      { split: "heldout", label: "ambiguous", gate: "escalate" },
      { split: "dev", label: "eligible", gate: "reject" },
    ]);
    assert.equal(metrics.falseNegatives, 1);
    assert.equal(metrics.eligible, 2);
    assert.equal(metrics.falseNegativeRate, 0.5);
    assert.equal(metrics.recall, 0.5);
    assert.equal(metrics.directPassRate, 0.5);
    assert.equal(metrics.gateRecall, 0.5);
    assert.equal(metrics.eligibleErrors, 0);
    assert.equal(metrics.cases, 4);
    assert.equal(metrics.coverage, 0.75);
    assert.equal(metrics.selectiveAccuracy, 2 / 3);
  });

  it("keeps gate recall apart from direct pass when a gate is null", () => {
    const metrics = officialMetrics([
      { split: "heldout", label: "eligible", gate: "pass" },
      { split: "heldout", label: "eligible", gate: "escalate" },
      { split: "heldout", label: "eligible", gate: "reject" },
      { split: "heldout", label: "eligible", gate: null },
    ]);
    assert.equal(metrics.eligible, 4);
    assert.equal(metrics.directPass, 1);
    assert.equal(metrics.directPassRate, 0.25);
    assert.equal(metrics.recall, 0.25);
    assert.equal(metrics.gateRecallHits, 2);
    assert.equal(metrics.gateRecall, 0.5);
    assert.equal(metrics.falseNegatives, 1);
    assert.equal(metrics.falseNegativeRate, 0.25);
    assert.equal(metrics.eligibleErrors, 1);
    assert.equal(metrics.gateRecall === 1 - metrics.falseNegatives / metrics.eligible, false);
  });
});

describe("live runner", () => {
  it("stops before the corpus when smoke cost is above zero", async () => {
    let decisions = 0;
    const result = await runLive({
      env: { OPENROUTER_API_KEY: "sk-or-v1-test-secret-value" },
      cases: [CASES[0]],
      intervalMs: 0,
      sleep: async () => {},
      retryDelaysMs: [0, 0],
      fetchImpl: async (url) => {
        const href = String(url);
        assert.equal(href.includes(DECISIONS_URL) || href.includes("openrouter.ai/api/v1/models"), true);
        if (href.includes("output_modalities")) return Response.json(catalogList);
        if (href.includes("/endpoints")) return Response.json(endpoints);
        decisions += 1;
        return Response.json({
          id: "gen-smoke",
          model: MODEL_ID,
          provider: "Perplexity",
          answers: { ready: { type: "noul", noul: 0.99 } },
          usage: { input_tokens: 8, output_tokens: 1, cost: 0.02 },
        });
      },
    });
    assert.equal(decisions, 1);
    assert.equal(result.stopped, "cost-above-zero");
    assert.equal(result.rows.length, 0);
    assert.equal(result.baseline.called, false);
    assert.equal(JSON.stringify(result).includes("sk-or-v1-test-secret-value"), false);
  });

  it("records a decisions response and does not call chat", async () => {
    const urls: string[] = [];
    const fixture = CASES[0];
    const built = decisionRequest(fixture);
    const answers: Record<string, unknown> = {};
    for (const [id, question] of Object.entries(built.body.questions)) {
      if (question.type === "noul") answers[id] = noul(0.05);
      else if (question.type === "score") answers[id] = score(question.criteria.length - 1);
      else answers[id] = choice("other");
    }
    const result = await runLive({
      env: { OPENROUTER_API_KEY: "sk-or-v1-test-secret-value" },
      cases: [fixture],
      intervalMs: 0,
      sleep: async () => {},
      retryDelaysMs: [0, 0],
      fetchImpl: async (url, init) => {
        const href = String(url);
        urls.push(href);
        if (href.includes("output_modalities")) {
          const headers = init?.headers;
          assert.equal(Boolean(headers && "authorization" in headers), false);
          return Response.json(catalogList);
        }
        if (href.includes("/endpoints")) return Response.json(endpoints);
        assert.equal(href, DECISIONS_URL);
        const body = JSON.parse(String(init?.body));
        assert.equal(body.provider.allow_fallbacks, false);
        assert.equal(body.model, MODEL_ID);
        if (body.questions.ready) {
          return Response.json({
            id: "gen-smoke",
            model: "perplexity/pplx-decider-v1.3-20261112",
            provider: "Perplexity",
            answers: { ready: { type: "noul", noul: 0.4 } },
            usage: { input_tokens: 12, output_tokens: 2, cost: 0, input_tokens_details: { cached_tokens: 3 } },
          });
        }
        return Response.json({
          id: "gen-case",
          model: "perplexity/pplx-decider-v1.3-20261112",
          provider: "Perplexity",
          answers,
          usage: { input_tokens: 40, output_tokens: 6, cost: 0 },
        });
      },
    });
    assert.equal(result.stopped, null);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].usage.inputTokens, 40);
    assert.equal(result.rows[0].usage.cachedTokens, null);
    assert.equal(result.smoke?.usage.cachedTokens, 3);
    assert.equal(result.smoke?.usage.reasoningTokens, null);
    assert.equal(result.rows[0].gate === "pass" || result.rows[0].gate === "reject" || result.rows[0].gate === "escalate", true);
    assert.equal(urls.some((url) => url.includes("chat/completions")), false);
    const parsed = parseCatalog(catalogList, endpoints);
    assert.equal(parsed.ok, true);
    const nested = parseCatalog(catalogList, { data: { id: MODEL_ID, endpoints: endpoints.data } });
    assert.equal(nested.ok, true);
    assert.equal(nested.providerName, "Perplexity");
  });

  it("does not send a decision when the key is absent", async () => {
    let calls = 0;
    const result = await runLive({
      env: {},
      cases: [CASES[0]],
      fetchImpl: async () => {
        calls += 1;
        return Response.json({});
      },
    });
    assert.equal(calls, 0);
    assert.equal(result.stopped, "missing-key");
  });

  it("stops a paid model before the next call would pass the cap", async () => {
    const jev = MODELS.find((model) => model.id === "typesafe/jev-1.14");
    assert.ok(jev);
    let decisions = 0;
    const result = await runLive({
      model: { ...jev, budgetUsd: 0.00001 },
      env: { OPENROUTER_API_KEY: "sk-or-v1-test-secret-value" },
      cases: [CASES[0], CASES[1]],
      intervalMs: 0,
      sleep: async () => {},
      retryDelaysMs: [0, 0],
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes("output_modalities")) {
          return Response.json({
            data: [
              {
                id: jev.id,
                canonical_slug: jev.canonicalSnapshot,
                pricing: { prompt: "0.000000042", completion: "0" },
                architecture: { output_modalities: ["decisions"] },
              },
            ],
          });
        }
        if (href.includes("/endpoints")) {
          return Response.json({ data: { endpoints: [{ provider_name: "TypeSafe", pricing: { prompt: "0.000000042", completion: "0" } }] } });
        }
        decisions += 1;
        return Response.json({
          id: "gen-paid",
          model: jev.canonicalSnapshot,
          provider: "TypeSafe",
          answers: { ready: { type: "noul", noul: 0.2 } },
          usage: { input_tokens: 1000, output_tokens: 10, cost: 0.000009 },
        });
      },
    });
    assert.equal(decisions, 1);
    assert.equal(result.stopped, "budget");
    assert.equal(result.rows.length, 0);
    assert.equal(result.budget.spentUsd, 0.000009);
    assert.equal(result.baseline.called, false);
    const summary = summarize(result);
    assert.equal(summary.savings.baselineCallsSent, false);
    assert.equal(summary.savings.kind, "scenario-estimate");
  });

  it("lets a paid model continue while the actual cost stays under the cap", async () => {
    const jev = MODELS.find((model) => model.id === "typesafe/jev-1.14");
    assert.ok(jev);
    let decisions = 0;
    const result = await runLive({
      model: jev,
      env: { OPENROUTER_API_KEY: "sk-or-v1-test-secret-value" },
      cases: [CASES[0]],
      intervalMs: 0,
      sleep: async () => {},
      retryDelaysMs: [0, 0],
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes("output_modalities")) {
          return Response.json({
            data: [
              {
                id: jev.id,
                canonical_slug: jev.canonicalSnapshot,
                pricing: { prompt: "0.000000042", completion: "0" },
                architecture: { output_modalities: ["decisions"] },
              },
            ],
          });
        }
        if (href.includes("/endpoints")) {
          return Response.json({ data: { endpoints: [{ provider_name: "TypeSafe", pricing: { prompt: "0.000000042", completion: "0" } }] } });
        }
        decisions += 1;
        return Response.json({
          id: "gen-paid",
          model: jev.canonicalSnapshot,
          provider: "TypeSafe",
          answers: { ready: { type: "noul", noul: 0.2 } },
          usage: { input_tokens: 20, output_tokens: 1, cost: 0.000001, output_tokens_details: { reasoning_tokens: 0 } },
        });
      },
    });
    assert.equal(decisions, 2);
    assert.equal(result.stopped, null);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].attemptLog.length, 1);
    assert.equal(result.rows[0].usage.reasoningTokens, 0);
    assert.equal(result.budget.spentUsd, 0.000002);
    assert.equal(parseCatalog(
      { data: [{ id: jev.id, canonical_slug: jev.canonicalSnapshot, pricing: { prompt: "0.000000042", completion: "0" }, architecture: { output_modalities: ["decisions"] } }] },
      { data: { endpoints: [{ provider_name: "TypeSafe", pricing: { prompt: "0.000000042", completion: "0" } }] } },
      jev,
    ).ok, true);
  });

  it("does not call a model id that the catalog omits", async () => {
    const jev = MODELS.find((model) => model.id === "typesafe/jev-1.14");
    assert.ok(jev);
    let decisions = 0;
    const result = await runLive({
      model: jev,
      env: { OPENROUTER_API_KEY: "sk-or-v1-test-secret-value" },
      cases: [CASES[0]],
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes("output_modalities")) return Response.json({ data: [] });
        if (href.includes("/endpoints")) return Response.json({ data: { endpoints: [] } });
        decisions += 1;
        return Response.json({});
      },
    });
    assert.equal(decisions, 0);
    assert.equal(result.stopped, "unavailable");
  });
});

describe("comparison", () => {
  it("reports paired disagreement intervals on the same 42 cases", () => {
    const usage = { inputTokens: 10, outputTokens: 1, cachedTokens: null, reasoningTokens: null, costUsd: 0 };
    const rows = CASES.map((fixture) => ({
      id: fixture.id,
      split: splitOf(fixture.id),
      label: fixture.label,
      gate: "escalate" as const,
      usage,
    }));
    const other = rows.map((row, index) => ({ ...row, gate: index === 2 ? ("pass" as const) : row.gate }));
    const comparison = compareRuns([
      { modelRequested: MODELS[0].id, rows, provenance: { source: "live", sameSession: true } },
      { modelRequested: MODELS[1].id, rows: other, provenance: { source: "live", sameSession: true } },
    ]);
    assert.equal(comparison.fairSame42, true);
    assert.equal(comparison.baselineCallsSent, false);
    assert.equal(comparison.labelsSent, false);
    assert.equal(comparison.pairs[0].all.differ, 1);
    assert.ok(comparison.pairs[0].all.disagreement);
    assert.equal(comparison.fingerprints.length, 42);
    assert.equal(compareRuns([{ modelRequested: "partial", rows: rows.slice(0, 2) }]).fairSame42, false);
    const band = wilson(6, 8);
    assert.ok(band);
    assert.equal(band.p, 0.75);
    assert.ok(Math.abs(band.low - 0.409) < 0.02);
    assert.ok(Math.abs(band.high - 0.929) < 0.02);
    assert.equal(wilson(1, 0), null);
    const paired = pairedGates(
      [{ id: "e01", split: "dev", gate: "pass" }],
      [{ id: "e01", split: "dev", gate: "reject" }],
    );
    assert.equal(paired.passDiscordant.aOnly, 1);
    assert.equal(paired.passDiscordant.ci?.n, 1);
    assert.equal(projectCallUsd({ x: 1 }, { promptPerToken: 0.000000042, completionPerToken: 0 }, { inputTokens: 10, outputTokens: 1, costUsd: 0.2 }), 0.2);
    assert.equal(projectCallUsd({ x: 1 }, { promptPerToken: null, completionPerToken: 0 }, null), null);
    const report = renderReport({
      mode: "live",
      modelRequested: MODEL_ID,
      canonicalSnapshot: "perplexity/pplx-decider-v1.3-20261112",
      billing: "free",
      budgetCapUsd: null,
      budget: { spentUsd: 0 },
      decisionsUrl: DECISIONS_URL,
      allowFallbacks: false,
      webGrounding: false,
      key: { variable: "OPENROUTER_API_KEY" },
      stopped: null,
      smoke: null,
      catalog: null,
      rows: [],
    } as unknown as Awaited<ReturnType<typeof runLive>>);
    assert.equal(report.includes("Direct pass:"), true);
    assert.equal(report.includes("Gate recall:"), true);
    assert.equal(report.includes("scenario estimate"), true);
  });
});

describe("benchmark corpus hygiene", () => {
  it("pins a fixed reference date in decision requests (B3)", () => {
    const { body } = decisionRequest(CASES[0]);
    const today = (body.state as unknown as { candidate: { today: string } }).candidate.today;
    assert.equal(today, BENCHMARK_REFERENCE_DATE.slice(0, 10));
  });

  it("does not use gold-leaking ids in neutral review inputs (B1)", () => {
    const reviewDir = join(new URL(".", import.meta.url).pathname, "review");
    const neutral = join(reviewDir, "neutral-cases.json");
    try {
      readFileSync(neutral);
    } catch {
      return;
    }
    const payload = JSON.parse(readFileSync(neutral, "utf8")) as { cases?: { id?: string }[] };
    for (const row of payload.cases ?? []) {
      if (typeof row.id === "string") assert.match(row.id, /^(?!e\d|n\d|a\d)/);
    }
  });
});
