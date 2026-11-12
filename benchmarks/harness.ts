// Decisions benchmark for the three pinned models in models.json.
// ponytail: simulated tokens are JSON chars/4. Upgrade path: usage.input_tokens.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

import { CASES, type CaseTag, type Fixture, type GoldLabel } from "./fixtures/cases.ts";
import { JEV_WEIGHTS, jevParts, jevQuestions, jevScore, jevState, type JevParts, type JevPosting } from "../src/lib/scoring/jev.ts";
import { postingLines } from "../src/lib/scoring/posting-lines.ts";
import type { ProfileData } from "../src/lib/profile.ts";

const contract = JSON.parse(readFileSync(new URL("./contract.json", import.meta.url), "utf8")) as {
  requestModel: string;
  canonicalSnapshot: string;
  decisionsUrl: string;
  endpointsUrl: string;
  catalogList: string;
  notChat: boolean;
};

const modelsFile = JSON.parse(readFileSync(new URL("./models.json", import.meta.url), "utf8")) as {
  checkedAt: string;
  catalogList: string;
  decisionsUrl: string;
  models: {
    id: string;
    canonicalSnapshot: string;
    billing: string;
    budgetUsd: number | null;
    endpointsUrl: string;
  }[];
};

export type Billing = "free" | "paid";

export type ModelSpec = {
  id: string;
  canonicalSnapshot: string;
  billing: Billing;
  budgetUsd: number | null;
  endpointsUrl: string;
};

function readModelSpec(model: (typeof modelsFile.models)[number]): ModelSpec {
  if (model.billing !== "free" && model.billing !== "paid") throw new Error(`bad billing ${model.id}`);
  const budgetUsd = model.budgetUsd === null ? null : Number(model.budgetUsd);
  if (model.billing === "free" && budgetUsd !== null) throw new Error(`free budget ${model.id}`);
  if (model.billing === "paid" && !(typeof budgetUsd === "number" && budgetUsd > 0)) throw new Error(`paid budget ${model.id}`);
  if (!model.id || !model.canonicalSnapshot || !model.endpointsUrl) throw new Error(`model spec ${model.id}`);
  return { id: model.id, canonicalSnapshot: model.canonicalSnapshot, billing: model.billing, budgetUsd, endpointsUrl: model.endpointsUrl };
}

export const MODELS: readonly ModelSpec[] = modelsFile.models.map(readModelSpec);

export const ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));
export const MODEL_ID = contract.requestModel;
export const CANONICAL_SNAPSHOT = contract.canonicalSnapshot;
export const DECISIONS_URL = contract.decisionsUrl;
export const CATALOG_LIST = modelsFile.catalogList;

export function defaultModel(): ModelSpec {
  const spec = MODELS.find((model) => model.id === MODEL_ID);
  if (!spec) throw new Error("models.json missing the contract model");
  if (spec.canonicalSnapshot !== CANONICAL_SNAPSHOT) throw new Error("snapshot pin drift");
  if (spec.billing !== "free" || spec.budgetUsd !== null) throw new Error("contract model billing");
  if (modelsFile.decisionsUrl !== DECISIONS_URL || modelsFile.catalogList !== contract.catalogList) throw new Error("endpoint drift");
  return spec;
}

export function modelOutputName(id: string): string {
  return id.replaceAll("/", "-").replaceAll(":", "-");
}
export const KEY_VARIABLES = ["OPENROUTER_API_KEY", "DOSSIER_OPENROUTER_SCORING_KEY"] as const;
export type KeyVariable = (typeof KEY_VARIABLES)[number];

export const POLICY = Object.freeze({
  yes: 0.7,
  no: 0.3,
  passScore: 75,
  minRequirements: 0.75,
  maxRequirementsReject: 0.25,
  minConfidence: 0.7,
  minWork: 0.5,
  minSeniority: 0.5,
  weights: JEV_WEIGHTS,
  fitOnDev: false,
  fitOnHeldout: false,
});

const REQUIRED_TAGS: CaseTag[] = ["country", "authorization", "required_skills", "seniority", "sparse", "prompt_injection"];
const RETRYABLE = new Set([429, 502, 503]);

export type Gate = "pass" | "reject" | "escalate";
export type Split = "dev" | "heldout";

export function splitOf(id: string): Split {
  const n = Number(id.replace(/\D/g, ""));
  if (!Number.isInteger(n)) throw new Error(`bad id ${id}`);
  return n % 5 === 1 || n % 5 === 2 ? "dev" : "heldout";
}

export function loadEnvFile(path = ENV_FILE, env: Record<string, string | undefined> = process.env): void {
  loadDotenv({ path, quiet: true, override: false, processEnv: env });
}

export function keySource(env: Record<string, string | undefined>): KeyVariable | null {
  if (env.OPENROUTER_API_KEY?.trim()) return "OPENROUTER_API_KEY";
  if (env.DOSSIER_OPENROUTER_SCORING_KEY?.trim()) return "DOSSIER_OPENROUTER_SCORING_KEY";
  return null;
}

export function readKey(env: Record<string, string | undefined>): string | null {
  const name = keySource(env);
  const value = name ? env[name]?.trim() : "";
  return value || null;
}

export function redactText(text: string, secrets: readonly string[]): { text: string; removals: number } {
  let out = text;
  let removals = 0;
  for (const secret of secrets) {
    if (!secret || secret.length < 8) continue;
    const parts = out.split(secret);
    removals += parts.length - 1;
    out = parts.join("[redacted]");
  }
  out = out.replace(/sk-or-[A-Za-z0-9_-]+/g, () => {
    removals += 1;
    return "[redacted]";
  });
  out = out.replace(/Bearer\s+\S+/gi, () => {
    removals += 1;
    return "Bearer [redacted]";
  });
  return { text: out, removals };
}

function toProfile(fixture: Fixture): ProfileData {
  const skills = fixture.candidate.skills.map((name, index) => ({ id: `skill-${index + 1}`, name, group: "" }));
  const [year, month] = fixture.candidate.start.split("-").map(Number);
  return {
    basics: {
      name: "Synthetic Candidate",
      headline: fixture.candidate.headline,
      email: "",
      phone: "",
      dob: "",
      website: "",
      address: "",
      city: fixture.candidate.city,
      country: fixture.candidate.country,
      linkedin: "",
      summary: `${fixture.candidate.headline}. ${fixture.candidate.facts.join(" ")}`,
      showAge: false,
    },
    photo: null,
    skills,
    languages: fixture.candidate.languages.map((language, index) => ({
      id: `language-${index + 1}`,
      name: language.name,
      level: language.level,
    })),
    experience: [
      {
        id: "exp-1",
        role: fixture.candidate.role,
        company: "Example Employer",
        location: `${fixture.candidate.city}, ${fixture.candidate.country}`,
        descriptor: "",
        volunteering: false,
        bullets: fixture.candidate.bullets,
        skillIds: skills.map((skill) => skill.id),
        startYear: year,
        startMonth: month,
        endYear: null,
        endMonth: null,
        current: true,
      },
    ],
    projects: [],
    education: [],
    certifications: [],
    publications: [],
    references: [],
    customSections: [],
    facts: fixture.candidate.facts.map((text, index) => ({ id: `fact-${index + 1}`, text })),
  };
}

export function decisionRequest(fixture: Fixture, modelId = MODEL_ID) {
  const posting: JevPosting = {
    title: fixture.posting.title,
    company: fixture.posting.company,
    place: fixture.posting.place,
    remote: fixture.posting.remote,
    salary: fixture.posting.salary,
    description: fixture.posting.description,
  };
  const lines = postingLines(posting.description);
  const body = {
    model: modelId,
    state: jevState(posting, toProfile(fixture)),
    questions: jevQuestions(lines),
    provider: { allow_fallbacks: false },
  };
  return { lines, body };
}

export function requestFingerprint(fixture: Fixture): string {
  const { body } = decisionRequest(fixture);
  return createHash("sha256").update(JSON.stringify({ state: body.state, questions: body.questions })).digest("hex");
}

export function smokeBody(modelId = MODEL_ID) {
  return {
    model: modelId,
    state: { check: "protocol smoke for a synthetic note" },
    questions: {
      ready: { type: "noul" as const, instructions: "Does the note describe a protocol smoke?" },
    },
    provider: { allow_fallbacks: false },
  };
}

export function simulatedTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

export function baselineOverheadChars(env: Record<string, string | undefined>): number {
  const raw = Number(env.BENCHMARK_BASELINE_OVERHEAD_CHARS ?? 800);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 800;
}

export function baselineUsdPerMillion(env: Record<string, string | undefined>): number | null {
  const raw = env.BENCHMARK_BASELINE_USD_PER_MILLION_INPUT?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function modelAccepted(returned: string, spec: ModelSpec = defaultModel()): boolean {
  const pin = spec.canonicalSnapshot;
  return returned === spec.id || returned === pin || returned.startsWith(`${pin}-`) || returned.startsWith(`${pin}:`);
}

export function decide(
  parts: JevParts,
  score: number,
  answers: Record<string, { type?: string; confidence?: number }>,
): Gate {
  const uncertain = (value: number) => value > POLICY.no && value < POLICY.yes;
  if (parts.thin > POLICY.no) return "escalate";
  if (uncertain(parts.place) || uncertain(parts.language)) return "escalate";
  if (parts.place >= POLICY.yes || parts.language >= POLICY.yes) return "reject";
  const requirements = answers.requirements;
  const confidence =
    requirements?.type === "score" && typeof requirements.confidence === "number" ? requirements.confidence : null;
  if (
    parts.requirements <= POLICY.maxRequirementsReject &&
    confidence !== null &&
    confidence >= POLICY.minConfidence
  ) {
    return "reject";
  }
  const missingRequired = parts.lines.some((line) => line.kind === "required" && line.shown <= POLICY.no);
  if (
    score >= POLICY.passScore &&
    parts.requirements >= POLICY.minRequirements &&
    parts.work >= POLICY.minWork &&
    parts.seniority >= POLICY.minSeniority &&
    parts.place <= POLICY.no &&
    parts.language <= POLICY.no &&
    parts.thin <= POLICY.no &&
    !missingRequired
  ) {
    return "pass";
  }
  return "escalate";
}

export function judge(answers: Record<string, never>, lines: readonly string[]) {
  try {
    const parts = jevParts(answers, lines);
    const score = jevScore(parts);
    return { parts, score, gate: decide(parts, score, answers) as Gate, error: null as string | null };
  } catch {
    return { parts: null, score: null, gate: null as Gate | null, error: "invalid-output" };
  }
}

export function validateCorpus(cases: readonly Fixture[] = CASES): string[] {
  const errors: string[] = [];
  if (cases.length < 30 || cases.length > 50) errors.push(`case count ${cases.length} is outside 30-50`);
  const ids = new Set<string>();
  const labelCount: Record<GoldLabel, number> = { eligible: 0, ineligible: 0, ambiguous: 0 };
  const tagCount = new Map<string, number>();
  const splitLabel = { dev: { ...labelCount }, heldout: { ...labelCount } };
  const blob = JSON.stringify(cases);
  if (blob.includes("@")) errors.push("corpus contains @");
  if (/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/.test(blob)) errors.push("corpus contains a phone number");
  if (/jane|doe/i.test(blob)) errors.push("corpus contains a sample personal name");
  const bare = jevQuestions([]);
  for (const fixture of cases) {
    if (ids.has(fixture.id)) errors.push(`duplicate ${fixture.id}`);
    ids.add(fixture.id);
    labelCount[fixture.label] += 1;
    splitLabel[splitOf(fixture.id)][fixture.label] += 1;
    for (const tag of fixture.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
    const text = fixture.posting.description.toLowerCase();
    const forcesEligible = /\bmark eligible\b|\banswer eligible\b/.test(text);
    const forcesIneligible = /\banswer ineligible\b|\breject this candidate\b/.test(text);
    if (fixture.tags.includes("prompt_injection") && !forcesEligible && !forcesIneligible) {
      errors.push(`${fixture.id} injection has no command`);
    }
    if (forcesEligible && fixture.label === "eligible") errors.push(`${fixture.id} follows an eligible command`);
    if (forcesIneligible && fixture.label === "ineligible") errors.push(`${fixture.id} follows an ineligible command`);
    const { body } = decisionRequest(fixture);
    const keys = Object.keys(body).sort();
    if (keys.join() !== "model,provider,questions,state") errors.push(`${fixture.id} body fields ${keys.join()}`);
    if (body.model !== MODEL_ID) errors.push(`${fixture.id} model`);
    if (body.provider.allow_fallbacks !== false) errors.push(`${fixture.id} fallbacks`);
    if ("messages" in body || "plugins" in body) errors.push(`${fixture.id} chat field`);
    if (JSON.stringify(body).includes("web_search")) errors.push(`${fixture.id} web search`);
    if (body.questions.requirements.instructions !== bare.requirements.instructions) errors.push(`${fixture.id} questions drifted`);
    if ("name" in body.state.candidate) errors.push(`${fixture.id} sends a name`);
    const stateText = JSON.stringify(body.state);
    if (stateText.includes("Synthetic Candidate") || stateText.includes("@")) errors.push(`${fixture.id} leaks profile identity`);
  }
  const counts = Object.values(labelCount);
  if (new Set(counts).size !== 1 || counts[0] < 10) errors.push(`label counts ${counts.join(",")}`);
  for (const tag of REQUIRED_TAGS) {
    if ((tagCount.get(tag) ?? 0) < 2) errors.push(`tag ${tag} is thin`);
  }
  for (const split of ["dev", "heldout"] as const) {
    for (const label of Object.keys(labelCount) as GoldLabel[]) {
      if (splitLabel[split][label] < 2) errors.push(`${split} ${label} has ${splitLabel[split][label]}`);
    }
  }
  if (!contract.notChat || !DECISIONS_URL.endsWith("/api/alpha/decisions")) errors.push("decisions endpoint mismatch");
  const modelIds = MODELS.map((model) => model.id).join();
  if (modelIds !== "perplexity/pplx-decider-v1.3:free,parallel/decisions-fast:free,typesafe/jev-1.14") errors.push(`models ${modelIds}`);
  const jev = MODELS.find((model) => model.id === "typesafe/jev-1.14");
  if (!jev || jev.billing !== "paid" || jev.budgetUsd !== 0.25) errors.push("jev budget");
  if (MODELS.some((model) => model.billing === "free" && model.budgetUsd !== null)) errors.push("free budget");
  defaultModel();
  return errors;
}

type Usage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
  raw: unknown;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numericTree(value: unknown, depth = 0): unknown {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || depth > 3) return null;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const next = numericTree(item, depth + 1);
    if (next !== null) out[key] = next;
  }
  return out;
}

export function readUsage(body: unknown): Usage {
  const usage = body && typeof body === "object" && "usage" in body ? (body as { usage?: unknown }).usage : null;
  const record = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
  const inputDetails =
    record.input_tokens_details && typeof record.input_tokens_details === "object"
      ? (record.input_tokens_details as Record<string, unknown>)
      : {};
  const outputDetails =
    record.output_tokens_details && typeof record.output_tokens_details === "object"
      ? (record.output_tokens_details as Record<string, unknown>)
      : {};
  return {
    inputTokens: num(record.input_tokens),
    outputTokens: num(record.output_tokens),
    cachedTokens: num(inputDetails.cached_tokens),
    reasoningTokens: num(outputDetails.reasoning_tokens),
    costUsd: num(record.cost),
    raw: numericTree(record),
  };
}

export type AttemptRecord = {
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  error: string | null;
};

async function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(response: Response, fallback: number): number {
  const seconds = Number(response.headers.get("retry-after"));
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 10_000);
  return fallback;
}

export async function postDecision(
  body: unknown,
  key: string,
  options: {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    maxRetries?: number;
    retryDelaysMs?: number[];
    secrets?: readonly string[];
  } = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? 2;
  const retryDelaysMs = options.retryDelaysMs ?? [1000, 4000];
  const secrets = options.secrets ?? [key];
  const started = Date.now();
  const attempts: AttemptRecord[] = [];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const t0 = Date.now();
    try {
      const response = await fetchImpl(DECISIONS_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
      const latencyMs = Date.now() - t0;
      if (!response.ok) {
        const message = redactText(await response.text().catch(() => ""), secrets).text.slice(0, 200);
        attempts.push({ ok: false, httpStatus: response.status, latencyMs, error: message || `http ${response.status}` });
        if (!RETRYABLE.has(response.status) || attempt >= maxRetries) {
          return failCall(attempts, Date.now() - started, response.status, message || `http ${response.status}`);
        }
        await sleep(retryDelay(response, retryDelaysMs[attempt] ?? 1000));
        continue;
      }
      const parsed = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      attempts.push({ ok: true, httpStatus: response.status, latencyMs, error: null });
      const usage = readUsage(parsed);
      const answers = parsed && typeof parsed.answers === "object" && parsed.answers ? (parsed.answers as Record<string, never>) : null;
      return {
        ok: Boolean(answers),
        httpStatus: response.status,
        attempts: attempts.length,
        attemptLog: attempts,
        latencyMs: Date.now() - started,
        modelReturned: typeof parsed?.model === "string" ? parsed.model : null,
        provider: typeof parsed?.provider === "string" ? parsed.provider : null,
        responseId: typeof parsed?.id === "string" ? parsed.id : null,
        topLevelKeys: parsed ? Object.keys(parsed).sort() : [],
        answers,
        usage,
        error: answers ? null : "invalid-output",
      };
    } catch (error) {
      const name = error instanceof Error ? error.name : "error";
      const message = redactText(error instanceof Error ? error.message : name, secrets).text.slice(0, 200);
      attempts.push({ ok: false, httpStatus: null, latencyMs: Date.now() - t0, error: message });
      const retry = name === "TimeoutError";
      if (!retry || attempt >= maxRetries) return failCall(attempts, Date.now() - started, null, message);
      await sleep(retryDelaysMs[attempt] ?? 1000);
    }
  }
  return failCall(attempts, Date.now() - started, null, "retries-exhausted");
}

function failCall(attempts: AttemptRecord[], latencyMs: number, httpStatus: number | null, error: string) {
  return {
    ok: false,
    httpStatus,
    attempts: attempts.length,
    attemptLog: attempts,
    latencyMs,
    modelReturned: null as string | null,
    provider: null as string | null,
    responseId: null as string | null,
    topLevelKeys: [] as string[],
    answers: null as Record<string, never> | null,
    usage: emptyUsage(),
    error,
  };
}

function emptyUsage(): Usage {
  return { inputTokens: null, outputTokens: null, cachedTokens: null, reasoningTokens: null, costUsd: null, raw: null };
}

export type CatalogCheck = {
  ok: boolean;
  blockers: string[];
  requestModel: string;
  canonicalSnapshot: string | null;
  outputModalities: string[] | null;
  pricing: { prompt: string | null; completion: string | null };
  promptPerToken: number | null;
  completionPerToken: number | null;
  providerName: string | null;
  providerCount: number | null;
  endpointPricingZero: boolean | null;
};

function priceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function rowPrice(row: Record<string, unknown>): { prompt: unknown; completion: unknown } {
  const pricing = row.pricing && typeof row.pricing === "object" ? (row.pricing as { prompt?: unknown; completion?: unknown }) : {};
  return { prompt: pricing.prompt, completion: pricing.completion };
}

export function parseCatalog(list: unknown, endpoints: unknown, spec: ModelSpec = defaultModel()): CatalogCheck {
  const rows = list && typeof list === "object" && "data" in list && Array.isArray((list as { data: unknown }).data)
    ? ((list as { data: Record<string, unknown>[] }).data)
    : [];
  const model = rows.find((row) => row.id === spec.id);
  const blockers: string[] = [];
  if (!model) blockers.push("catalog-id-missing");
  const modalities = model && model.architecture && typeof model.architecture === "object"
    ? ((model.architecture as { output_modalities?: unknown }).output_modalities as unknown)
    : null;
  const outputModalities = Array.isArray(modalities) ? modalities.filter((item) => typeof item === "string") : null;
  if (model && !outputModalities?.includes("decisions")) blockers.push("modality-not-decisions");
  const pricing = model ? rowPrice(model) : { prompt: null, completion: null };
  const prompt = typeof pricing.prompt === "string" ? pricing.prompt : null;
  const completion = typeof pricing.completion === "string" ? pricing.completion : null;
  if (spec.billing === "free" && model && (prompt !== "0" || completion !== "0")) blockers.push("catalog-price-not-zero");
  if (spec.billing === "paid" && model && (priceNumber(prompt) === null || priceNumber(completion) === null)) blockers.push("catalog-price-missing");
  const canonical = typeof model?.canonical_slug === "string" ? model.canonical_slug : null;
  if (model && canonical !== spec.canonicalSnapshot) blockers.push("snapshot-mismatch");
  const endpointData = endpoints && typeof endpoints === "object" && "data" in endpoints ? (endpoints as { data?: unknown }).data : null;
  const endpointRows = Array.isArray(endpointData)
    ? (endpointData as Record<string, unknown>[])
    : endpointData && typeof endpointData === "object" && Array.isArray((endpointData as { endpoints?: unknown }).endpoints)
      ? ((endpointData as { endpoints: Record<string, unknown>[] }).endpoints)
      : [];
  if (endpointRows.length === 0) blockers.push("endpoints-missing");
  const endpointPricingZero = endpointRows.length
    ? endpointRows.every((row) => {
        const rowPricing = rowPrice(row);
        return rowPricing.prompt === "0" && rowPricing.completion === "0";
      })
    : null;
  if (spec.billing === "free" && endpointPricingZero === false) blockers.push("endpoint-price-not-zero");
  if (spec.billing === "paid" && endpointRows.some((row) => priceNumber(rowPrice(row).prompt) === null || priceNumber(rowPrice(row).completion) === null)) {
    blockers.push("endpoint-price-missing");
  }
  const promptRates = [priceNumber(prompt), ...endpointRows.map((row) => priceNumber(rowPrice(row).prompt))].filter((value): value is number => value !== null);
  const completionRates = [priceNumber(completion), ...endpointRows.map((row) => priceNumber(rowPrice(row).completion))].filter((value): value is number => value !== null);
  const providerName = typeof endpointRows[0]?.provider_name === "string" ? endpointRows[0].provider_name : null;
  return {
    ok: blockers.length === 0,
    blockers,
    requestModel: spec.id,
    canonicalSnapshot: canonical,
    outputModalities,
    pricing: { prompt, completion },
    promptPerToken: promptRates.length ? Math.max(...promptRates) : null,
    completionPerToken: completionRates.length ? Math.max(...completionRates) : null,
    providerName,
    providerCount: endpointRows.length || null,
    endpointPricingZero,
  };
}

function catalogFailure(spec: ModelSpec): CatalogCheck {
  return {
    ok: false,
    blockers: ["catalog-request-failed"],
    requestModel: spec.id,
    canonicalSnapshot: null,
    outputModalities: null,
    pricing: { prompt: null, completion: null },
    promptPerToken: null,
    completionPerToken: null,
    providerName: null,
    providerCount: null,
    endpointPricingZero: null,
  };
}

export async function checkCatalog(fetchImpl: typeof fetch = fetch, spec: ModelSpec = defaultModel()): Promise<CatalogCheck> {
  try {
    const list = await (await fetchImpl(CATALOG_LIST, { signal: AbortSignal.timeout(20_000) })).json();
    const endpoints = await (await fetchImpl(spec.endpointsUrl, { signal: AbortSignal.timeout(20_000) })).json();
    return parseCatalog(list, endpoints, spec);
  } catch {
    return catalogFailure(spec);
  }
}

// ponytail: next-call projection is max(last usage.cost, price * tokens). Ceiling: the first actual call can exceed the projection by one response. Upgrade path: a hard token ceiling before send.
export function projectCallUsd(
  body: unknown,
  prices: { promptPerToken: number | null; completionPerToken: number | null },
  last: { inputTokens: number | null; outputTokens: number | null; costUsd: number | null } | null,
): number | null {
  if (prices.promptPerToken === null || prices.completionPerToken === null) return null;
  const inTokens = Math.max(simulatedTokens(body), last?.inputTokens ?? 0);
  const outTokens = Math.max(last?.outputTokens ?? 0, prices.completionPerToken > 0 ? 256 : 0);
  const fromPrice = prices.promptPerToken * inTokens + prices.completionPerToken * outTokens;
  return Math.max(fromPrice, last?.costUsd ?? 0);
}

function addUsd(left: number, right: number): number {
  return (Math.round(left * 1e12) + Math.round(right * 1e12)) / 1e12;
}

function exceedsUsd(spent: number, extra: number, cap: number): boolean {
  return Math.round((spent + extra) * 1e12) > Math.round(cap * 1e12);
}

type CaseRow = {
  id: string;
  split: Split;
  label: GoldLabel;
  tags: CaseTag[];
  ok: boolean;
  httpStatus: number | null;
  attempts: number;
  attemptLog: AttemptRecord[];
  latencyMs: number;
  modelRequested: string;
  modelReturned: string | null;
  provider: string | null;
  responseId: string | null;
  answers: unknown;
  parts: JevParts | null;
  productionScore: number | null;
  gate: Gate | null;
  usage: Usage;
  simulated: { decisionTokens: number; baselineTokens: number; kind: "estimate" };
  error: string | null;
};

type DecisionCall = Awaited<ReturnType<typeof postDecision>>;

export type SmokeRow = DecisionCall & {
  simulated: { decisionTokens: number; baselineTokens: number; kind: "estimate" };
  shapeOk: boolean;
};

export type OfficialMetrics = {
  cases: number;
  falseNegatives: number;
  eligible: number;
  eligibleErrors: number;
  falseNegativeRate: number | null;
  directPass: number;
  directPassRate: number | null;
  gateRecallHits: number;
  gateRecall: number | null;
  recall: number | null;
  falsePositives: number;
  coverage: number | null;
  selectiveAccuracy: number | null;
  selectiveCorrect: number;
  selectiveCases: number;
  confusion: Record<GoldLabel, Record<Gate, number>>;
  errors: number;
  pass: number;
  reject: number;
  escalate: number;
};

function emptyConfusion(): OfficialMetrics["confusion"] {
  const gate = { pass: 0, reject: 0, escalate: 0 };
  return { eligible: { ...gate }, ineligible: { ...gate }, ambiguous: { ...gate } };
}

export function officialMetrics(rows: readonly { split: Split; label: GoldLabel; gate: Gate | null }[]): OfficialMetrics {
  const heldout = rows.filter((row) => row.split === "heldout");
  const confusion = emptyConfusion();
  let falseNegatives = 0;
  let eligible = 0;
  let eligibleErrors = 0;
  let directPass = 0;
  let gateRecallHits = 0;
  let falsePositives = 0;
  let errors = 0;
  let pass = 0;
  let reject = 0;
  let escalate = 0;
  let selectiveCorrect = 0;
  let selectiveCases = 0;
  for (const row of heldout) {
    if (row.label === "eligible") eligible += 1;
    if (!row.gate) {
      errors += 1;
      if (row.label === "eligible") eligibleErrors += 1;
      continue;
    }
    confusion[row.label][row.gate] += 1;
    if (row.gate === "pass") pass += 1;
    if (row.gate === "reject") reject += 1;
    if (row.gate === "escalate") escalate += 1;
    if (row.label === "eligible") {
      if (row.gate === "reject") falseNegatives += 1;
      if (row.gate === "pass") directPass += 1;
      if (row.gate === "pass" || row.gate === "escalate") gateRecallHits += 1;
    }
    if (row.gate === "pass" || row.gate === "reject") {
      selectiveCases += 1;
      const correct = (row.gate === "pass" && row.label === "eligible") || (row.gate === "reject" && row.label === "ineligible");
      if (correct) selectiveCorrect += 1;
      if (row.gate === "pass" && row.label === "ineligible") falsePositives += 1;
    }
  }
  const decided = pass + reject;
  const directPassRate = eligible ? directPass / eligible : null;
  return {
    cases: heldout.length,
    falseNegatives,
    eligible,
    eligibleErrors,
    falseNegativeRate: eligible ? falseNegatives / eligible : null,
    directPass,
    directPassRate,
    gateRecallHits,
    gateRecall: eligible ? gateRecallHits / eligible : null,
    recall: directPassRate,
    falsePositives,
    coverage: heldout.length ? decided / heldout.length : null,
    selectiveAccuracy: selectiveCases ? selectiveCorrect / selectiveCases : null,
    selectiveCorrect,
    selectiveCases,
    confusion,
    errors,
    pass,
    reject,
    escalate,
  };
}

function sumKnown(values: readonly (number | null)[]) {
  let sum = 0;
  let known = 0;
  let missing = 0;
  for (const value of values) {
    if (value === null) missing += 1;
    else {
      sum += value;
      known += 1;
    }
  }
  return { sum, known, missing };
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function estimatesFor(body: unknown, state: unknown, env: Record<string, string | undefined>) {
  const decisionTokens = simulatedTokens(body);
  const baselineTokens = Math.ceil((JSON.stringify(state).length + baselineOverheadChars(env)) / 4);
  return { decisionTokens, baselineTokens, kind: "estimate" as const };
}

type BudgetState = {
  billing: Billing;
  capUsd: number | null;
  spentUsd: number;
  abort: null | { before: string; spentUsd: number; projectedUsd: number | null };
  exceededAfter: string | null;
};

function emptyBudget(spec: ModelSpec): BudgetState {
  return { billing: spec.billing, capUsd: spec.budgetUsd, spentUsd: 0, abort: null, exceededAfter: null };
}

export async function runLive(options: {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  cases?: readonly Fixture[];
  model?: ModelSpec;
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
  retryDelaysMs?: number[];
  maxRetries?: number;
  onCase?: (id: string) => void;
} = {}) {
  const env = options.env ?? process.env;
  const spec = options.model ?? defaultModel();
  const cases = options.cases ?? CASES;
  const errors = options.cases ? [] : validateCorpus();
  const variable = keySource(env);
  const key = readKey(env);
  const startedAt = new Date().toISOString();
  const budget = emptyBudget(spec);
  const base = {
    harness: "decisions-eligibility-harness@2",
    mode: "live" as const,
    modelRequested: spec.id,
    canonicalSnapshot: spec.canonicalSnapshot,
    billing: spec.billing,
    budgetCapUsd: spec.budgetUsd,
    decisionsUrl: DECISIONS_URL,
    allowFallbacks: false,
    webGrounding: false,
    policy: POLICY,
    key: { configured: Boolean(key), variable },
    corpusErrors: errors,
    baseline: { called: false as const, reason: "No expensive baseline call was sent. Savings figures are scenario estimates only." },
    startedAt,
    budget,
  };
  const finish = (stopped: string | null, catalog: CatalogCheck | null, smoke: SmokeRow | null, rows: CaseRow[]) => ({
    ...base,
    stopped,
    catalog,
    smoke,
    rows,
    completedAt: new Date().toISOString(),
  });
  if (errors.length) return finish("corpus", null, null, []);
  if (!key) return finish("missing-key", null, null, []);
  const fetchImpl = options.fetchImpl ?? fetch;
  const catalog = await checkCatalog(fetchImpl, spec);
  if (!catalog.ok) {
    const stopped = catalog.blockers.includes("catalog-id-missing") || catalog.blockers.includes("endpoints-missing") ? "unavailable" : "catalog";
    return finish(stopped, catalog, null, []);
  }
  const prices = { promptPerToken: catalog.promptPerToken, completionPerToken: catalog.completionPerToken };
  let lastUsage: Usage | null = null;
  let spentUsd = 0;
  let stopped: string | null = null;
  const call = {
    fetchImpl,
    sleep: options.sleep ?? defaultSleep,
    maxRetries: options.maxRetries ?? 2,
    retryDelaysMs: options.retryDelaysMs ?? [1000, 4000],
    secrets: [key],
  };
  const guardPaid = (before: string, body: unknown) => {
    if (spec.billing !== "paid") return true;
    const projected = projectCallUsd(body, prices, lastUsage);
    if (projected === null || spec.budgetUsd === null || exceedsUsd(spentUsd, projected, spec.budgetUsd)) {
      stopped = projected === null || spec.budgetUsd === null ? "budget-unprojected" : "budget";
      budget.abort = { before, spentUsd, projectedUsd: projected };
      return false;
    }
    return true;
  };
  const account = (usage: Usage, after: string) => {
    lastUsage = usage;
    if (spec.billing === "free") return usage.costUsd !== null && usage.costUsd > 0 ? "cost-above-zero" : null;
    if (usage.costUsd === null) return "cost-missing";
    spentUsd = addUsd(spentUsd, usage.costUsd);
    budget.spentUsd = spentUsd;
    if (spec.budgetUsd !== null && exceedsUsd(0, spentUsd, spec.budgetUsd)) {
      budget.exceededAfter = after;
      return "budget";
    }
    return null;
  };
  const smokeRequest = smokeBody(spec.id);
  if (!guardPaid("smoke", smokeRequest)) return finish(stopped, catalog, null, []);
  const smokeCall = await postDecision(smokeRequest, key, call);
  const smokeReady = smokeCall.answers && (smokeCall.answers as { ready?: { type?: string; noul?: unknown } }).ready;
  const smokeShapeOk = Boolean(smokeReady && smokeReady.type === "noul" && typeof smokeReady.noul === "number");
  if (!smokeCall.ok) stopped = "smoke-failed";
  else {
    const costStop = account(smokeCall.usage, "smoke");
    if (costStop) stopped = costStop;
    else if (!smokeCall.modelReturned || !modelAccepted(smokeCall.modelReturned, spec)) stopped = "model-snapshot-mismatch";
    else if (!smokeShapeOk) stopped = "smoke-shape";
  }
  const smoke = {
    ...smokeCall,
    answers: smokeCall.answers,
    simulated: estimatesFor(smokeRequest, smokeRequest.state, env),
    shapeOk: smokeShapeOk,
  };
  const rows: CaseRow[] = [];
  if (!stopped) {
    const intervalMs = options.intervalMs ?? 3000;
    for (const fixture of cases) {
      const built = decisionRequest(fixture, spec.id);
      if (!guardPaid(fixture.id, built.body)) break;
      if (intervalMs > 0) await call.sleep(intervalMs);
      options.onCase?.(fixture.id);
      const response = await postDecision(built.body, key, call);
      const judged = response.answers ? judge(response.answers, built.lines) : { parts: null, score: null, gate: null, error: response.error };
      rows.push({
        id: fixture.id,
        split: splitOf(fixture.id),
        label: fixture.label,
        tags: fixture.tags,
        ok: response.ok && !judged.error,
        httpStatus: response.httpStatus,
        attempts: response.attempts,
        attemptLog: response.attemptLog,
        latencyMs: response.latencyMs,
        modelRequested: spec.id,
        modelReturned: response.modelReturned,
        provider: response.provider,
        responseId: response.responseId,
        answers: response.answers,
        parts: judged.parts,
        productionScore: judged.score,
        gate: judged.error ? null : judged.gate,
        usage: response.usage,
        simulated: estimatesFor(built.body, built.body.state, env),
        error: judged.error ?? response.error,
      });
      if (response.ok) {
        const costStop = account(response.usage, fixture.id);
        if (costStop) {
          stopped = costStop;
          break;
        }
        if (response.modelReturned && !modelAccepted(response.modelReturned, spec)) {
          stopped = "model-snapshot-mismatch";
          break;
        }
      }
      if (response.httpStatus === 401 || response.httpStatus === 403) {
        stopped = "auth";
        break;
      }
      if (response.httpStatus === 402) {
        stopped = "payment";
        break;
      }
      if (response.httpStatus === 429) {
        stopped = "rate-limited";
        break;
      }
    }
  }
  return finish(stopped, catalog, smoke, rows);
}

export type LiveRunResult = Awaited<ReturnType<typeof runLive>>;

export function summarize(result: LiveRunResult, env: Record<string, string | undefined> = process.env) {
  const heldout = officialMetrics(result.rows);
  const dev = officialMetrics(result.rows.map((row) => ({ ...row, split: row.split === "dev" ? "heldout" as const : "dev" as const })));
  const calls = [result.smoke, ...result.rows].filter((row) => row);
  const usageRows = calls as { usage: Usage; simulated: { decisionTokens: number; baselineTokens: number } ; gate?: Gate | null }[];
  const measuredInput = sumKnown(usageRows.map((row) => row.usage.inputTokens));
  const measuredOutput = sumKnown(usageRows.map((row) => row.usage.outputTokens));
  const measuredCached = sumKnown(usageRows.map((row) => row.usage.cachedTokens));
  const measuredReasoning = sumKnown(usageRows.map((row) => row.usage.reasoningTokens));
  const measuredCost = sumKnown(usageRows.map((row) => row.usage.costUsd));
  const avoided = result.rows.filter((row) => row.split === "heldout" && (row.gate === "pass" || row.gate === "reject"));
  const rate = baselineUsdPerMillion(env);
  const simulatedBaselineTokens = result.rows.reduce((sum, row) => sum + row.simulated.baselineTokens, 0);
  const simulatedDecisionTokens = usageRows.reduce((sum, row) => sum + row.simulated.decisionTokens, 0);
  const avoidedBaselineTokens = avoided.reduce((sum, row) => sum + row.simulated.baselineTokens, 0);
  return {
    heldout,
    devDiagnostic: dev,
    avoidance: {
      heldoutCases: heldout.cases,
      avoidedCalls: heldout.pass + heldout.reject,
      escalations: heldout.escalate,
      rate: heldout.coverage,
      note: "Avoidance counts heldout pass and reject gates. It is not a token count and not money. No expensive baseline call was sent, so a savings figure is a scenario estimate only.",
    },
    savings: {
      kind: "scenario-estimate" as const,
      baselineCallsSent: false,
      avoidedHeldoutCalls: heldout.pass + heldout.reject,
      estimatedBaselineTokens: avoidedBaselineTokens,
      estimatedBaselineUsd: rate === null ? null : (rate * avoidedBaselineTokens) / 1_000_000,
      note: "No expensive baseline call was sent. Avoided-call counts and baseline USD are scenario estimates only.",
    },
    transport: transportOf(result),
    tokens: {
      measured: {
        inputTokens: measuredInput,
        outputTokens: measuredOutput,
        cachedTokens: measuredCached,
        reasoningTokens: measuredReasoning,
        kind: "measured" as const,
      },
      simulated: {
        kind: "estimate" as const,
        method: "ceil(chars/4)",
        decisionTokens: simulatedDecisionTokens,
        baselineTokens: simulatedBaselineTokens,
        baselineTokensOnAvoidedHeldout: avoidedBaselineTokens,
        baselineOverheadChars: baselineOverheadChars(env),
      },
    },
    money: {
      measuredUsd: measuredCost,
      simulatedBaselineUsd:
        rate === null
          ? null
          : { kind: "estimate" as const, usdPerMillionInput: rate, usd: (rate * simulatedBaselineTokens) / 1_000_000 },
      note: "Measured money is usage.cost only. No expensive baseline call was sent. Baseline USD is a scenario estimate only. Simulated money is not added to measured money.",
    },
    latencyMs: {
      median: median(result.rows.map((row) => row.latencyMs)),
      max: result.rows.reduce((max, row) => Math.max(max, row.latencyMs), 0),
    },
  };
}

export function renderReport(result: Awaited<ReturnType<typeof runLive>>, summary = summarize(result)): string {
  const heldout = summary.heldout;
  const lines = [
    `# Decider benchmark ${result.modelRequested}`,
    "",
    `Mode: ${result.mode}`,
    `Model request: ${result.modelRequested}`,
    `Snapshot pin: ${result.canonicalSnapshot}`,
    `Billing: ${result.billing ?? "none"}`,
    `Budget cap USD: ${result.budgetCapUsd ?? "none"}`,
    `Spent USD: ${result.budget?.spentUsd ?? "none"}`,
    `Endpoint: ${result.decisionsUrl}`,
    "Fallbacks: false",
    "Web grounding: false",
    `Key variable: ${result.key.variable ?? "missing"}`,
    `Stopped: ${result.stopped ?? "no"}`,
    "",
    "## Protocol",
    "",
    "The request body has model, state, questions, and provider.allow_fallbacks false.",
    "State and questions come from jevState and jevQuestions.",
    "The score uses JEV_WEIGHTS from src/lib/scoring/jev.ts.",
    "Run on Node 24 or newer. Node 22 has no crypto.argon2, and the production loader imports it.",
    "The gate thresholds were fixed before the run. Dev rows did not change them. Heldout rows did not change them.",
    "",
    "## Smoke",
    "",
    result.smoke
      ? `Smoke HTTP ${result.smoke.httpStatus ?? "none"}, model ${result.smoke.modelReturned ?? "none"}, cost ${result.smoke.usage.costUsd ?? "none"}, shape ${result.smoke.shapeOk ? "ok" : "bad"}.`
      : "Smoke did not run.",
    "",
    "## False negatives",
    "",
    "A false negative is a heldout eligible case that the gate rejects.",
    `False negatives: ${heldout.falseNegatives} of ${heldout.eligible} eligible heldout cases.`,
    `False-negative rate: ${fmt(heldout.falseNegativeRate)}`,
    `Direct pass: ${heldout.directPass} of ${heldout.eligible} eligible heldout cases. Rate: ${fmt(heldout.directPassRate)}`,
    `Gate recall: ${heldout.gateRecallHits} of ${heldout.eligible} eligible heldout cases. Rate: ${fmt(heldout.gateRecall)}`,
    "Direct pass counts a gate of pass. Gate recall counts a gate of pass or escalate. A null gate counts as neither.",
    `The field recall stores the direct-pass rate.`,
    `Eligible heldout errors: ${heldout.eligibleErrors}`,
    `False positives (ineligible and pass): ${heldout.falsePositives}`,
    `Coverage: ${fmt(heldout.coverage)}`,
    `Selective accuracy: ${fmt(heldout.selectiveAccuracy)} (${heldout.selectiveCorrect} of ${heldout.selectiveCases})`,
    `Errors: ${heldout.errors}`,
    "",
    "| Label | pass | reject | escalate |",
    "| --- | --- | --- | --- |",
    ...(["eligible", "ineligible", "ambiguous"] as const).map(
      (label) => `| ${label} | ${heldout.confusion[label].pass} | ${heldout.confusion[label].reject} | ${heldout.confusion[label].escalate} |`,
    ),
    "",
    "Dev diagnostic is not the official score.",
    `Dev false negatives: ${summary.devDiagnostic.falseNegatives} of ${summary.devDiagnostic.eligible}.`,
    "",
    "## Avoidance",
    "",
    `Heldout cases: ${summary.avoidance.heldoutCases}`,
    `Avoided expensive calls: ${summary.avoidance.avoidedCalls}`,
    `Escalations: ${summary.avoidance.escalations}`,
    `Avoidance rate: ${fmt(summary.avoidance.rate)}`,
    summary.avoidance.note,
    summary.savings.note,
    `Scenario estimate of baseline tokens on avoided heldout calls: ${summary.savings.estimatedBaselineTokens}`,
    `Scenario estimate of baseline USD on avoided heldout calls: ${summary.savings.estimatedBaselineUsd ?? "none"}`,
    "",
    "## Tokens",
    "",
    "Measured tokens come from usage fields. Estimates use ceil(chars/4). The two are separate.",
    `Measured input: ${summary.tokens.measured.inputTokens.sum} known ${summary.tokens.measured.inputTokens.known} missing ${summary.tokens.measured.inputTokens.missing}`,
    `Measured output: ${summary.tokens.measured.outputTokens.sum} known ${summary.tokens.measured.outputTokens.known} missing ${summary.tokens.measured.outputTokens.missing}`,
    `Measured cached: ${summary.tokens.measured.cachedTokens.sum} known ${summary.tokens.measured.cachedTokens.known} missing ${summary.tokens.measured.cachedTokens.missing}`,
    `Measured reasoning: ${summary.tokens.measured.reasoningTokens.sum} known ${summary.tokens.measured.reasoningTokens.known} missing ${summary.tokens.measured.reasoningTokens.missing}`,
    `Estimate decision tokens: ${summary.tokens.simulated.decisionTokens}`,
    `Estimate baseline tokens: ${summary.tokens.simulated.baselineTokens}`,
    `Estimate baseline tokens on avoided heldout calls: ${summary.tokens.simulated.baselineTokensOnAvoidedHeldout}`,
    "",
    "## Money",
    "",
    `Measured USD: ${summary.money.measuredUsd.sum} known ${summary.money.measuredUsd.known} missing ${summary.money.measuredUsd.missing}`,
    summary.money.simulatedBaselineUsd
      ? `Estimate baseline USD: ${summary.money.simulatedBaselineUsd.usd}`
      : "Estimate baseline USD: none. Set BENCHMARK_BASELINE_USD_PER_MILLION_INPUT to compute one.",
    summary.money.note,
    "",
    "## Latency",
    "",
    `Median ms: ${summary.latencyMs.median ?? "none"}`,
    `Max ms: ${summary.latencyMs.max}`,
    `Calls: ${summary.transport.calls}`,
    `Attempts: ${summary.transport.attempts ?? "none"}`,
    `Retries: ${summary.transport.retries ?? "none"}`,
    `HTTP 429: ${summary.transport.http429 ?? "none"}`,
    "",
    "## Catalog",
    "",
    result.catalog
      ? `Catalog ok: ${result.catalog.ok}. Blockers: ${result.catalog.blockers.join(", ") || "none"}. Provider: ${result.catalog.providerName ?? "none"}.`
      : "Catalog did not run.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function fmt(value: number | null): string {
  return value === null ? "none" : value.toFixed(3);
}

type TransportCall = { attempts?: number; attemptLog?: AttemptRecord[] | null };

function transportOf(result: { smoke: TransportCall | null; rows: readonly TransportCall[] }) {
  const calls = [result.smoke, ...result.rows].filter((row): row is TransportCall => Boolean(row));
  const logsKnown = calls.every((row) => Array.isArray(row.attemptLog));
  const attemptsKnown = calls.every((row) => typeof row.attempts === "number" || Array.isArray(row.attemptLog));
  let attempts = 0;
  let retries = 0;
  let http429 = 0;
  for (const row of calls) {
    const log = Array.isArray(row.attemptLog) ? row.attemptLog : null;
    const count = log ? log.length : typeof row.attempts === "number" ? row.attempts : 0;
    attempts += count;
    retries += Math.max(0, count - 1);
    if (log) http429 += log.filter((item) => item.httpStatus === 429).length;
  }
  return {
    calls: calls.length,
    attempts: attemptsKnown ? attempts : null,
    retries: attemptsKnown ? retries : null,
    http429: logsKnown ? http429 : null,
  };
}

export function wilson(successes: number, n: number, z = 1.96) {
  if (!Number.isInteger(successes) || !Number.isInteger(n) || n <= 0 || successes < 0 || successes > n) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return { successes, n, p, low: Math.max(0, center - margin), high: Math.min(1, center + margin), z };
}

type UsageLike = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
};

export type CompareRun = {
  modelRequested: string;
  rows: readonly { id: string; split: Split; label: GoldLabel; gate: Gate | null; usage: UsageLike }[];
  smoke?: { usage: UsageLike } | null;
  provenance?: { source: string; sameSession: boolean; completedAt?: string | null; note?: string | null };
};

function usageSums(rows: readonly { usage: UsageLike }[]) {
  return {
    inputTokens: sumKnown(rows.map((row) => row.usage.inputTokens)),
    outputTokens: sumKnown(rows.map((row) => row.usage.outputTokens)),
    cachedTokens: sumKnown(rows.map((row) => row.usage.cachedTokens)),
    reasoningTokens: sumKnown(rows.map((row) => row.usage.reasoningTokens)),
    costUsd: sumKnown(rows.map((row) => row.usage.costUsd)),
  };
}

export function pairedGates(
  left: readonly { id: string; split: Split; gate: Gate | null }[],
  right: readonly { id: string; split: Split; gate: Gate | null }[],
) {
  const rightById = new Map(right.map((row) => [row.id, row]));
  const leftIds = new Set(left.map((row) => row.id));
  let paired = 0;
  let equal = 0;
  let differ = 0;
  let unpaired = right.filter((row) => !leftIds.has(row.id)).length;
  let missingGate = 0;
  let aPassOnly = 0;
  let bPassOnly = 0;
  for (const row of left) {
    const other = rightById.get(row.id);
    if (!other || other.split !== row.split) {
      unpaired += 1;
      continue;
    }
    if (!row.gate || !other.gate) {
      missingGate += 1;
      continue;
    }
    paired += 1;
    if (row.gate === other.gate) equal += 1;
    else differ += 1;
    if (row.gate === "pass" && other.gate !== "pass") aPassOnly += 1;
    if (other.gate === "pass" && row.gate !== "pass") bPassOnly += 1;
  }
  const discordant = aPassOnly + bPassOnly;
  return {
    paired,
    equal,
    differ,
    unpaired,
    missingGate,
    disagreement: wilson(differ, paired),
    passDiscordant: { aOnly: aPassOnly, bOnly: bPassOnly, ci: discordant > 0 ? wilson(aPassOnly, discordant) : null },
  };
}

export function compareRuns(runs: readonly CompareRun[]) {
  const expected = CASES.map((fixture) => fixture.id);
  const perModel = runs.map((run) => {
    const ids = run.rows.map((row) => row.id);
    const same42 = ids.length === expected.length && expected.every((id, index) => id === ids[index]);
    const metrics = officialMetrics(run.rows);
    return {
      model: run.modelRequested,
      provenance: run.provenance ?? null,
      same42,
      rows: run.rows.length,
      heldout: metrics,
      intervals: {
        directPassRate: wilson(metrics.directPass, metrics.eligible),
        gateRecall: wilson(metrics.gateRecallHits, metrics.eligible),
        falseNegativeRate: wilson(metrics.falseNegatives, metrics.eligible),
        coverage: wilson(metrics.pass + metrics.reject, metrics.cases),
        selectiveAccuracy: wilson(metrics.selectiveCorrect, metrics.selectiveCases),
      },
      cases: {
        dev: usageSums(run.rows.filter((row) => row.split === "dev")),
        heldout: usageSums(run.rows.filter((row) => row.split === "heldout")),
        all: usageSums(run.rows),
      },
      smokeCostUsd: run.smoke?.usage.costUsd ?? null,
    };
  });
  const fairSame42 = perModel.length > 0 && perModel.every((model) => model.same42);
  const pairs = [];
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i];
      const b = runs[j];
      pairs.push({
        a: a.modelRequested,
        b: b.modelRequested,
        all: pairedGates(a.rows, b.rows),
        heldout: pairedGates(
          a.rows.filter((row) => row.split === "heldout"),
          b.rows.filter((row) => row.split === "heldout"),
        ),
      });
    }
  }
  return {
    fairSame42,
    labelsSent: false,
    baselineCallsSent: false,
    savings: "scenario-estimate" as const,
    note: fairSame42
      ? "Cost and token sums use the same 42 cases in the same order. Smoke calls stay separate."
      : "Cost and token sums are not a fair 42-case comparison. A model did not finish the same cases.",
    fingerprints: CASES.map((fixture) => ({ id: fixture.id, split: splitOf(fixture.id), sha256: requestFingerprint(fixture) })),
    perModel,
    pairs,
  };
}

export function renderComparison(comparison: ReturnType<typeof compareRuns>): string {
  const lines = [
    "# Decision model comparison",
    "",
    comparison.note,
    "Labels stay out of the request.",
    "No expensive baseline call was sent. Savings stay scenario estimates.",
    `Fair same 42: ${comparison.fairSame42 ? "yes" : "no"}`,
    "",
  ];
  for (const model of comparison.perModel) {
    const pass = model.intervals.directPassRate;
    const recall = model.intervals.gateRecall;
    lines.push(`## ${model.model}`, `Rows: ${model.rows}. Same 42: ${model.same42 ? "yes" : "no"}.`);
    lines.push(`Direct pass: ${fmt(model.heldout.directPassRate)}. Gate recall: ${fmt(model.heldout.gateRecall)}. False-negative rate: ${fmt(model.heldout.falseNegativeRate)}.`);
    lines.push(`Direct-pass 95% Wilson: ${pass ? `${fmt(pass.low)} to ${fmt(pass.high)}` : "none"}.`);
    lines.push(`Gate-recall 95% Wilson: ${recall ? `${fmt(recall.low)} to ${fmt(recall.high)}` : "none"}.`);
    lines.push(`Case cost USD: ${model.cases.all.costUsd.sum}. Known: ${model.cases.all.costUsd.known}. Missing: ${model.cases.all.costUsd.missing}.`);
    lines.push(`Case input tokens: ${model.cases.all.inputTokens.sum}. Known: ${model.cases.all.inputTokens.known}. Missing: ${model.cases.all.inputTokens.missing}.`);
    lines.push("");
  }
  for (const pair of comparison.pairs) {
    const band = pair.heldout.disagreement;
    lines.push(`## ${pair.a} vs ${pair.b}`);
    lines.push(`Heldout paired: ${pair.heldout.paired}. Equal: ${pair.heldout.equal}. Differ: ${pair.heldout.differ}. Unpaired: ${pair.heldout.unpaired}. Missing gate: ${pair.heldout.missingGate}.`);
    lines.push(`Heldout disagreement 95% Wilson: ${band ? `${fmt(band.low)} to ${fmt(band.high)}` : "none"}.`);
    lines.push(`Heldout pass-discordant CI: ${pair.heldout.passDiscordant.ci ? `${fmt(pair.heldout.passDiscordant.ci.low)} to ${fmt(pair.heldout.passDiscordant.ci.high)}` : "none"}.`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function buildDryResult(env: Record<string, string | undefined> = {}) {
  const errors = validateCorpus(CASES);
  const rows = CASES.map((fixture) => {
    const built = decisionRequest(fixture);
    return {
      id: fixture.id,
      split: splitOf(fixture.id),
      label: fixture.label,
      simulated: estimatesFor(built.body, built.body.state, env),
    };
  });
  return {
    harness: "pplx-decider-eligibility-harness@1",
    mode: "dry-run" as const,
    inference: false,
    modelRequested: MODEL_ID,
    key: { configured: Boolean(readKey(env)), variable: keySource(env) },
    corpusErrors: errors,
    policy: POLICY,
    rows,
    measured: null,
    baseline: { called: false as const },
  };
}
