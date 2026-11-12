import "server-only";

import { z } from "zod";

import { AiError } from "@/lib/ai/errors";
import type { PostingFit } from "@/lib/fit";
import type { ProfileData } from "@/lib/profile";
import type { UsageSink } from "@/lib/usage";

import { jevFit, jevParts, jevPostingText, jevQuestions, jevState, type JevPosting } from "./jev";
import { postingLines } from "./posting-lines";
import { OPENROUTER_DECISION_MODEL } from "./scorers";
import { answerSchema, type Answer, type Question } from "./typesafe";

// OpenRouter Decisions, verified 2026-11-12 against the public contract:
// POST https://openrouter.ai/api/alpha/decisions
// Catalog: GET https://openrouter.ai/api/v1/models?output_modalities=decisions
// Body fields: model, state, questions, provider.allow_fallbacks false.
// This file does not import benchmarks/. The pins match benchmarks/contract.json.
// Direct scorer: the same questions, weights, and line evidence as Jev.
// It is not the benchmark early-gate plus chat cascade.

export const SCORE_POSTING_OPENROUTER_DECISIONS_VERSION = "score-posting-openrouter-decisions@3";

export const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
export const DECISION_CATALOG_URL = "https://openrouter.ai/api/v1/models?output_modalities=decisions";

/**
 * Free decision models whose snapshot was checked on 2026-11-12.
 * ponytail: a newer snapshot of the same id fails closed until this pin is updated.
 * Upgrade path: accept a catalog row with the same id, price 0, and its canonical_slug.
 */
export const KNOWN_FREE_DECISION_MODELS = [
  { id: OPENROUTER_DECISION_MODEL, canonicalSnapshot: "perplexity/pplx-decider-v1.3-20261112" },
  { id: "parallel/decisions-fast:free", canonicalSnapshot: "parallel/decisions-fast-20261106" },
] as const;

export type DecisionPin = { id: string; canonicalSnapshot: string };

const AUTH = "OpenRouter didn't accept the key. Check it in Settings → Scoring.";
const RATE = "OpenRouter is limiting requests right now. Wait a minute and try again.";
const BUSY = "OpenRouter is overloaded right now. Try again in a moment.";
const TIMEOUT = "OpenRouter took too long to answer. Try again.";
const UNREACHABLE = "Couldn't reach OpenRouter. Check that the server can reach the internet.";
const INVALID = "OpenRouter's decision answer didn't come back in the expected shape. Try again.";
const MISMATCH = "OpenRouter returned a different decision model. Dossier did not use the score.";
const PROVIDER = "OpenRouter couldn't score this posting. Try again in a moment.";
const NOT_FREE = "That model is not a free OpenRouter decision model. Choose the free decision model in Settings → Scoring.";
const CATALOG_EMPTY = "OpenRouter listed no free decision model. The verified free models are shown.";

const RETRYABLE = new Set([429]);
const RETRY_DELAYS_MS = [1_000, 4_000];
const MAX_RETRY_AFTER_MS = 10_000;
const TIMEOUT_MS = 60_000;
const CATALOG_TIMEOUT_MS = 15_000;

const decisionResultSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), answerSchema),
});

export type DecisionUsage = { input: number | null; output: number | null; costUsd: number | null };

export type DecisionResult = {
  model: string;
  answers: Record<string, Answer>;
  usage: DecisionUsage;
};

/** True when `returned` is the requested id or that id's pinned snapshot. Same rule as the decisions harness. */
export function modelAccepted(returned: string, pin: DecisionPin): boolean {
  const snapshot = pin.canonicalSnapshot;
  return returned === pin.id || returned === snapshot || returned.startsWith(`${snapshot}-`) || returned.startsWith(`${snapshot}:`);
}

type CatalogRow = { id?: unknown; canonical_slug?: unknown; pricing?: unknown; architecture?: unknown };

/** Free decision models from a catalog payload. Paid rows and chat rows are left out. */
export function freeDecisionModels(payload: unknown): DecisionPin[] {
  const rows = payload && typeof payload === "object" && "data" in payload && Array.isArray((payload as { data: unknown }).data)
    ? ((payload as { data: CatalogRow[] }).data)
    : [];
  const found: DecisionPin[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string" || row.id.trim() === "") continue;
    const architecture = row.architecture && typeof row.architecture === "object" ? (row.architecture as { output_modalities?: unknown }) : {};
    const modalities = Array.isArray(architecture.output_modalities) ? architecture.output_modalities : [];
    if (!modalities.includes("decisions")) continue;
    const pricing = row.pricing && typeof row.pricing === "object" ? (row.pricing as { prompt?: unknown; completion?: unknown }) : {};
    if (pricing.prompt !== "0" || pricing.completion !== "0") continue;
    if (typeof row.canonical_slug !== "string" || row.canonical_slug.trim() === "") continue;
    found.push({ id: row.id, canonicalSnapshot: row.canonical_slug });
  }
  return found;
}

export function knownFreeDecisionModelIds(): string[] {
  return KNOWN_FREE_DECISION_MODELS.map((model) => model.id);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Tokens and cost from a decisions body. A present cost that is not a finite number >= 0 is invalid. */
export function readDecisionUsage(body: unknown): DecisionUsage | "invalid-cost" {
  const usage = body && typeof body === "object" && "usage" in body ? (body as { usage?: unknown }).usage : null;
  const record = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
  let costUsd: number | null = null;
  if (usage && typeof usage === "object" && "cost" in record) {
    const cost = record.cost;
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return "invalid-cost";
    costUsd = cost;
  }
  return { input: finite(record.input_tokens), output: finite(record.output_tokens), costUsd };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });

function retryDelay(response: Response, fallback: number): number {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : fallback;
}

function errorFor(response: Response): AiError {
  const detail = `OpenRouter decisions ${response.status}`;
  switch (response.status) {
    case 401:
    case 403:
      return new AiError("auth", AUTH, detail);
    case 408:
      return new AiError("timeout", TIMEOUT, detail);
    case 413:
      return new AiError("too-long", "The posting and your profile are more than the decision model can read at once. Try a shorter posting.", detail);
    case 429:
      return new AiError("rate-limited", RATE, detail);
    case 503:
    case 529:
      return new AiError("busy", BUSY, detail);
    default:
      return new AiError("provider", PROVIDER, detail);
  }
}

export type AskDecisionOptions = {
  key: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
  onUsage?: UsageSink;
  /** Set when the caller wants the tokens kept. The connection test leaves this unset. */
  usageTask?: "score-posting-openrouter-decisions";
};

function keepUsage(onUsage: UsageSink | undefined, task: AskDecisionOptions["usageTask"], model: string, usage: DecisionUsage) {
  if (!onUsage || !task) return;
  onUsage({ task, provider: "OPENROUTER_DECISIONS", model, input: usage.input, output: usage.output });
}

/**
 * One decisions request. 429 is tried again, at most twice, and never longer
 * than ten seconds. Any other status fails at once. A returned model that is
 * not the pin is refused. A cost above zero is refused. The answers are not
 * turned into a score in either case.
 */
export async function askOpenRouterDecision(
  request: { model: string; canonicalSnapshot: string; state: unknown; questions: Record<string, Question> },
  { key, signal, fetchImpl = fetch, timeoutMs = TIMEOUT_MS, retryDelaysMs = RETRY_DELAYS_MS, onUsage, usageTask }: AskDecisionOptions,
): Promise<DecisionResult> {
  const pin: DecisionPin = { id: request.model, canonicalSnapshot: request.canonicalSnapshot };
  const timeout = AbortSignal.timeout(timeoutMs);
  const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const body = JSON.stringify({
    model: request.model,
    state: request.state,
    questions: request.questions,
    provider: { allow_fallbacks: false },
  });
  let kept = false;
  const report = (model: string, usage: DecisionUsage) => {
    if (kept) return;
    kept = true;
    keepUsage(onUsage, usageTask, model, usage);
  };

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(DECISIONS_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
        body,
        signal: both,
        redirect: "error",
        cache: "no-store",
      });
    } catch (error) {
      if (signal?.aborted) throw AiError.of("cancelled");
      if (timeout.aborted) throw new AiError("timeout", TIMEOUT, "OpenRouter decisions timeout");
      throw new AiError("unreachable", UNREACHABLE, error instanceof Error ? error.name : undefined);
    }

    if (response.ok) {
      const raw = await response.json().catch(() => null);
      const usage = readDecisionUsage(raw);
      const model = raw && typeof raw === "object" && "model" in raw && typeof (raw as { model: unknown }).model === "string" ? (raw as { model: string }).model : request.model;
      if (usage === "invalid-cost") {
        report(model, { input: null, output: null, costUsd: null });
        throw new AiError("invalid-output", INVALID, "OpenRouter decisions cost");
      }
      const parsed = decisionResultSchema.safeParse(raw);
      if (!parsed.success) {
        report(model, usage);
        throw new AiError("invalid-output", INVALID, "OpenRouter decisions answer");
      }
      if (!modelAccepted(parsed.data.model, pin)) {
        report(parsed.data.model, usage);
        throw new AiError("model", MISMATCH, `OpenRouter decisions model ${parsed.data.model}`);
      }
      if (usage.costUsd !== null && usage.costUsd > 0) {
        report(parsed.data.model, usage);
        throw new AiError("provider", `OpenRouter reported a cost of ${usage.costUsd} USD. Dossier did not use the score.`, "OpenRouter decisions cost");
      }
      report(parsed.data.model, usage);
      return { model: parsed.data.model, answers: parsed.data.answers, usage };
    }

    await response.arrayBuffer().catch(() => undefined);
    if (!RETRYABLE.has(response.status) || attempt >= retryDelaysMs.length) throw errorFor(response);
    await sleep(retryDelay(response, retryDelaysMs[attempt] ?? 1_000), both);
    if (signal?.aborted) throw AiError.of("cancelled");
    if (timeout.aborted) throw new AiError("timeout", TIMEOUT, "OpenRouter decisions timeout");
  }
}

async function readFreeCatalog(fetchImpl: typeof fetch, signal?: AbortSignal): Promise<DecisionPin[]> {
  const timeout = AbortSignal.timeout(CATALOG_TIMEOUT_MS);
  const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetchImpl(DECISION_CATALOG_URL, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: both,
      redirect: "error",
      cache: "no-store",
    });
  } catch (error) {
    if (signal?.aborted) throw AiError.of("cancelled");
    throw new AiError("unreachable", UNREACHABLE, error instanceof Error ? error.name : undefined);
  }
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new AiError("provider", "Couldn't read OpenRouter's decision models. Try again in a moment.", `OpenRouter catalog ${response.status}`);
  }
  return freeDecisionModels(await response.json().catch(() => null));
}

/**
 * The pin for `model`. A known free id uses its checked snapshot and does not
 * call the catalog. Any other id must be in the live free decision catalog.
 * A miss does not send a decisions request.
 */
export async function resolveDecisionPin(model: string, options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): Promise<DecisionPin> {
  const known = KNOWN_FREE_DECISION_MODELS.find((item) => item.id === model);
  if (known) return { id: known.id, canonicalSnapshot: known.canonicalSnapshot };
  const rows = await readFreeCatalog(options.fetchImpl ?? fetch, options.signal);
  const row = rows.find((item) => item.id === model);
  if (!row) throw new AiError("config", NOT_FREE, "decision-model-not-free");
  return row;
}

/** Ids for the decision model list. The default free model comes first when the catalog has it. */
export async function listFreeDecisionModelIds(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const rows = await readFreeCatalog(fetchImpl);
  const ids = rows.map((row) => row.id);
  const rest = ids.filter((id) => id !== OPENROUTER_DECISION_MODEL).sort((a, b) => a.localeCompare(b));
  return ids.includes(OPENROUTER_DECISION_MODEL) ? [OPENROUTER_DECISION_MODEL, ...rest] : rest;
}

export const DECISION_CATALOG_EMPTY = CATALOG_EMPTY;

export function decisionScoredWith(model: string, costUsd: number | null): string {
  const cost = costUsd === null ? "unknown" : String(costUsd);
  return `${SCORE_POSTING_OPENROUTER_DECISIONS_VERSION} (${model}) costUsd=${cost}`;
}

/**
 * Scores `posting` with an OpenRouter decision model. `scoredWith` names this
 * version, the model the response returned, and the cost the response reported.
 *
 */
export async function scoreWithOpenRouterDecisions(
  posting: JevPosting,
  profile: ProfileData,
  { key, model, signal, fetchImpl, timeoutMs, retryDelaysMs, onUsage, today = new Date() }: AskDecisionOptions & { model: string; today?: Date },
): Promise<{ data: PostingFit; scoredWith: string }> {
  const pin = await resolveDecisionPin(model, { fetchImpl, signal });
  const text = jevPostingText(posting.description);
  const trimmed = { ...posting, description: text };
  const lines = postingLines(text);
  const result = await askOpenRouterDecision(
    { model: pin.id, canonicalSnapshot: pin.canonicalSnapshot, state: jevState(trimmed, profile, today), questions: jevQuestions(lines) },
    { key, signal, fetchImpl, timeoutMs, retryDelaysMs, onUsage, usageTask: "score-posting-openrouter-decisions" },
  );
  const parts = jevParts(result.answers, lines, (id) => new AiError("invalid-output", INVALID, `OpenRouter decision answer without ${id}`));
  return { data: jevFit(parts), scoredWith: decisionScoredWith(result.model, result.usage.costUsd) };
}

/** One short decisions question, for Settings → Scoring and onboarding. */
export async function probeOpenRouterDecision(
  key: string,
  model: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<DecisionResult> {
  const pin = await resolveDecisionPin(model, options);
  const result = await askOpenRouterDecision(
    {
      model: pin.id,
      canonicalSnapshot: pin.canonicalSnapshot,
      state: { check: "protocol smoke for a synthetic note" },
      questions: { ready: { type: "noul", instructions: "Does the note describe a protocol smoke?" } },
    },
    { key, timeoutMs: options.timeoutMs ?? TIMEOUT_MS, retryDelaysMs: [], fetchImpl: options.fetchImpl, signal: options.signal },
  );
  const ready = result.answers.ready;
  if (ready?.type !== "noul" || typeof ready.noul !== "number") throw new AiError("invalid-output", INVALID, "OpenRouter decision probe");
  return result;
}
