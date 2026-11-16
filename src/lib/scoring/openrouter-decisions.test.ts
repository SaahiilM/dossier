import { describe, expect, it, vi } from "vitest";

import { AiError } from "@/lib/ai/errors";
import { demoProfile } from "@/lib/demo-profile";

import { jevFit, jevParts, jevQuestions } from "./jev";
import {
  DECISION_CATALOG_URL,
  DECISIONS_URL,
  KNOWN_FREE_DECISION_MODELS,
  decisionScoredWith,
  freeDecisionModels,
  listFreeDecisionModelIds,
  modelAccepted,
  probeOpenRouterDecision,
  readDecisionUsage,
  scoreWithOpenRouterDecisions,
} from "./openrouter-decisions";
import { postingLines } from "./posting-lines";
import { OPENROUTER_DECISION_MODEL } from "./scorers";

const profile = demoProfile();
const posting = {
  title: "Senior Product Designer",
  company: "Ledgerly",
  place: "Amsterdam",
  remote: false,
  salary: "",
  description: "You know Figma and a design system.",
};
const pin = KNOWN_FREE_DECISION_MODELS[0];
const lines = postingLines(posting.description);

function answersFor(description = posting.description) {
  const questions = jevQuestions(postingLines(description));
  return Object.fromEntries(
    Object.entries(questions).map(([id, question]) => {
      if (question.type === "score") return [id, { type: "score", score: question.criteria.length - 1, confidence: 0.9, probabilities: {} }];
      if (question.type === "noul") return [id, { type: "noul", noul: 0.05 }];
      return [id, { type: "choice", choice: "required", confidence: 0.9, probabilities: { required: 0.9 } }];
    }),
  );
}

const decisionJson = (model: string, answers: unknown, usage: unknown = { input_tokens: 40, output_tokens: 6, cost: 0 }, status = 200) =>
  new Response(JSON.stringify({ id: "gen-test", provider: "Perplexity", model, answers, usage }), { status, headers: { "content-type": "application/json" } });

function fetchOf(...responses: (Response | ((url: string) => Response))[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected ${url}`);
    return typeof next === "function" ? next(url) : next;
  });
  return { fetchImpl, calls };
}

const catalog = {
  data: [
    {
      id: OPENROUTER_DECISION_MODEL,
      canonical_slug: pin.canonicalSnapshot,
      pricing: { prompt: "0", completion: "0" },
      architecture: { output_modalities: ["decisions"] },
    },
    {
      id: "typesafe/jev-1.14",
      canonical_slug: "typesafe/jev-1.14-20261014",
      pricing: { prompt: "0.000002", completion: "0.000002" },
      architecture: { output_modalities: ["decisions"] },
    },
    {
      id: "openai/gpt-4.1-mini",
      canonical_slug: "openai/gpt-4.1-mini",
      pricing: { prompt: "0", completion: "0" },
      architecture: { output_modalities: ["text"] },
    },
    {
      id: "other/decider:free",
      canonical_slug: "other/decider-20260101",
      pricing: { prompt: "0", completion: "0" },
      architecture: { output_modalities: ["decisions"] },
    },
    {
      id: "no-snapshot:free",
      pricing: { prompt: "0", completion: "0" },
      architecture: { output_modalities: ["decisions"] },
    },
  ],
};

describe("decision model pin", () => {
  it("accepts the requested id and its snapshot, and refuses a different model", () => {
    expect(modelAccepted(OPENROUTER_DECISION_MODEL, pin)).toBe(true);
    expect(modelAccepted(pin.canonicalSnapshot, pin)).toBe(true);
    expect(modelAccepted(`${pin.canonicalSnapshot}:free`, pin)).toBe(true);
    expect(modelAccepted(`${pin.canonicalSnapshot}-extra`, pin)).toBe(true);
    expect(modelAccepted("perplexity/pplx-decider-flash-v1.3:free", pin)).toBe(false);
    expect(modelAccepted("perplexity/pplx-decider-v1.2", pin)).toBe(false);
    expect(modelAccepted("typesafe/jev-1.14", pin)).toBe(false);
  });

  it("keeps free decision rows and drops paid rows, chat rows, and rows without a snapshot", () => {
    expect(freeDecisionModels(catalog).map((row) => row.id)).toEqual([OPENROUTER_DECISION_MODEL, "other/decider:free"]);
    expect(freeDecisionModels({ data: "nope" })).toEqual([]);
  });
});

describe("scoreWithOpenRouterDecisions", () => {
  it("posts the Jev questions to the decisions endpoint and keeps the snapshot, tokens, and cost", async () => {
    const answers = answersFor();
    const { fetchImpl, calls } = fetchOf(decisionJson(pin.canonicalSnapshot, answers, { input_tokens: 40, output_tokens: 6, cost: 0, input_tokens_details: { cached_tokens: 3 } }));
    const onUsage = vi.fn();
    const result = await scoreWithOpenRouterDecisions(posting, profile, { key: "sk-or-test", model: OPENROUTER_DECISION_MODEL, fetchImpl, onUsage, retryDelaysMs: [] });

    expect(result.data).toEqual(jevFit(jevParts(answers, lines)));
    expect(result.data.score).toBeGreaterThanOrEqual(0);
    expect(result.data.score).toBeLessThanOrEqual(100);
    expect(result.scoredWith).toBe(decisionScoredWith(pin.canonicalSnapshot, 0));
    expect(onUsage).toHaveBeenCalledWith({
      task: "score-posting-openrouter-decisions",
      provider: "OPENROUTER_DECISIONS",
      model: pin.canonicalSnapshot,
      input: 40,
      output: 6,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(DECISIONS_URL);
    expect(calls[0].url).not.toContain("chat/completions");
    const init = calls[0].init;
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-or-test");
    const body = JSON.parse(String(init?.body)) as { model: string; provider: { allow_fallbacks: boolean }; questions: Record<string, unknown>; state: { candidate: { name?: string } } };
    expect(body.model).toBe(OPENROUTER_DECISION_MODEL);
    expect(body.provider).toEqual({ allow_fallbacks: false });
    expect(body.questions).toEqual(jevQuestions(lines));
    expect(body.state.candidate.name).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("messages");
  });

  it("keeps an unknown cost as unknown and does not invent tokens", async () => {
    const answers = answersFor();
    const { fetchImpl } = fetchOf(decisionJson(pin.canonicalSnapshot, answers, {}));
    const onUsage = vi.fn();
    const result = await scoreWithOpenRouterDecisions(posting, profile, { key: "sk-or-test", model: OPENROUTER_DECISION_MODEL, fetchImpl, onUsage, retryDelaysMs: [] });
    expect(result.scoredWith).toBe(decisionScoredWith(pin.canonicalSnapshot, null));
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ input: null, output: null }));
    expect(readDecisionUsage({ usage: { cost: "0" } })).toBe("invalid-cost");
  });

  it("refuses a substitute model and does not return a score", async () => {
    const { fetchImpl } = fetchOf(decisionJson("perplexity/pplx-decider-flash-v1.3:free", answersFor()));
    const onUsage = vi.fn();
    await expect(
      scoreWithOpenRouterDecisions(posting, profile, { key: "sk-or-test", model: OPENROUTER_DECISION_MODEL, fetchImpl, onUsage, retryDelaysMs: [] }),
    ).rejects.toMatchObject({ kind: "model", message: expect.stringMatching(/did not use the score/) });
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ model: "perplexity/pplx-decider-flash-v1.3:free", input: 40, output: 6 }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses a positive cost and does not return a score", async () => {
    const { fetchImpl } = fetchOf(decisionJson(pin.canonicalSnapshot, answersFor(), { input_tokens: 9, output_tokens: 1, cost: 0.02 }));
    const onUsage = vi.fn();
    await expect(
      scoreWithOpenRouterDecisions(posting, profile, { key: "sk-or-test", model: OPENROUTER_DECISION_MODEL, fetchImpl, onUsage, retryDelaysMs: [] }),
    ).rejects.toMatchObject({ kind: "provider", message: expect.stringMatching(/0\.02 USD/) });
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ input: 9, output: 1 }));
  });

  it("refuses an incomplete answer and does not build a score", async () => {
    const answers = answersFor();
    answers.requirements = { type: "score" };
    const { fetchImpl } = fetchOf(decisionJson(pin.canonicalSnapshot, answers, { input_tokens: 3, output_tokens: 1, cost: 0 }));
    const onUsage = vi.fn();
    const error = await scoreWithOpenRouterDecisions(posting, profile, { key: "sk-or-test", model: OPENROUTER_DECISION_MODEL, fetchImpl, onUsage, retryDelaysMs: [] }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ kind: "invalid-output" });
    expect((error as AiError).message).not.toMatch(/TypeSafe/);
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ input: 3, output: 1 }));
  });

  it("refuses a paid model before the decisions request", async () => {
    const { fetchImpl, calls } = fetchOf((url) => (url === DECISION_CATALOG_URL ? Response.json(catalog) : decisionJson(pin.canonicalSnapshot, answersFor())));
    await expect(scoreWithOpenRouterDecisions(posting, profile, { key: "sk-or-test", model: "typesafe/jev-1.14", fetchImpl, retryDelaysMs: [] })).rejects.toMatchObject({
      kind: "config",
      message: expect.stringMatching(/free/),
    });
    expect(calls.map((call) => call.url)).toEqual([DECISION_CATALOG_URL]);
  });

  it("pins an unknown free catalog model to that row's snapshot", async () => {
    const answers = answersFor();
    const route = (url: string) => (url === DECISION_CATALOG_URL ? Response.json(catalog) : decisionJson("other/decider-20260101", answers, { input_tokens: 11, output_tokens: 2, cost: 0 }));
    const { fetchImpl, calls } = fetchOf(route, route);
    const result = await scoreWithOpenRouterDecisions(posting, profile, { key: "sk-or-test", model: "other/decider:free", fetchImpl, retryDelaysMs: [] });
    expect(result.scoredWith).toBe(decisionScoredWith("other/decider-20260101", 0));
    expect(calls.map((call) => call.url)).toEqual([DECISION_CATALOG_URL, DECISIONS_URL]);
    expect(JSON.parse(String(calls[1].init?.body)).model).toBe("other/decider:free");
  });

  it("tries a 429 again, then stops", async () => {
    const answers = answersFor();
    const { fetchImpl } = fetchOf(
      new Response("slow", { status: 429, headers: { "retry-after": "0" } }),
      decisionJson(OPENROUTER_DECISION_MODEL, answers),
    );
    await expect(scoreWithOpenRouterDecisions(posting, profile, { key: "sk-or-test", model: OPENROUTER_DECISION_MODEL, fetchImpl, retryDelaysMs: [0, 0] })).resolves.toMatchObject({
      scoredWith: decisionScoredWith(OPENROUTER_DECISION_MODEL, 0),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const limited = fetchOf(new Response("", { status: 429 }), new Response("", { status: 429 }), new Response("", { status: 429 }));
    await expect(
      scoreWithOpenRouterDecisions(posting, profile, { key: "sk-or-test", model: OPENROUTER_DECISION_MODEL, fetchImpl: limited.fetchImpl, retryDelaysMs: [0, 0] }),
    ).rejects.toMatchObject({ kind: "rate-limited" });
    expect(limited.fetchImpl).toHaveBeenCalledTimes(3);
    expect(limited.calls[0].init?.body && JSON.parse(String(limited.calls[0].init.body)).provider.allow_fallbacks).toBe(false);
  });

  it("stops on cancel and on timeout", async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = vi.fn<typeof fetch>(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(
      scoreWithOpenRouterDecisions(posting, profile, { key: "sk-or-test", model: OPENROUTER_DECISION_MODEL, fetchImpl: aborted, signal: controller.signal, retryDelaysMs: [] }),
    ).rejects.toMatchObject({ kind: "cancelled" });

    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError"))));
    await expect(
      scoreWithOpenRouterDecisions(posting, profile, { key: "sk-or-test", model: OPENROUTER_DECISION_MODEL, fetchImpl: hanging, timeoutMs: 20, retryDelaysMs: [] }),
    ).rejects.toMatchObject({ kind: "timeout" });
  });
});

describe("decision catalog and connection test", () => {
  it("lists free decision models with the default first", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(catalog));
    expect(await listFreeDecisionModelIds(fetchImpl)).toEqual([OPENROUTER_DECISION_MODEL, "other/decider:free"]);
    expect(fetchImpl.mock.calls[0][0]).toBe(DECISION_CATALOG_URL);
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get("authorization")).toBeNull();
  });

  it("checks the connection with one decisions question", async () => {
    const { fetchImpl, calls } = fetchOf(decisionJson(pin.canonicalSnapshot, { ready: { type: "noul", noul: 0.4 } }, { input_tokens: 8, output_tokens: 1, cost: 0 }));
    const result = await probeOpenRouterDecision("sk-or-test", OPENROUTER_DECISION_MODEL, { fetchImpl, timeoutMs: 1000 });
    expect(result.model).toBe(pin.canonicalSnapshot);
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.questions.ready).toMatchObject({ type: "noul" });
    expect(body.provider.allow_fallbacks).toBe(false);
    expect(calls[0].url).toBe(DECISIONS_URL);
  });
});
