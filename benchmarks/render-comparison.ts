// Standalone comparison report. No network. No model calls.
// Run from the repo root: npx tsx benchmarks/render-comparison.ts

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { CASES, type Fixture, type GoldLabel } from "./fixtures/cases.ts";

type Gold = GoldLabel;
type Action = "pass" | "reject" | "escalate";
type SplitName = "dev" | "heldout";
type SliceKey = "all" | "heldout" | "dev" | "clear" | "heldout-clear";
type Kind = "api" | "review";

const GOLD: readonly Gold[] = ["eligible", "ineligible", "ambiguous"];
const ACTION: readonly Action[] = ["pass", "reject", "escalate"];
const EXPECTED: Record<Gold, Action> = { eligible: "pass", ineligible: "reject", ambiguous: "escalate" };
const SLICE_KEYS: readonly SliceKey[] = ["all", "heldout", "dev", "clear", "heldout-clear"];
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(ROOT, "out");
const HTML_PATH = path.join(OUT_DIR, "comparison.html");
const JSON_PATH = path.join(OUT_DIR, "comparison.json");
const GENERATOR = "render-comparison";

const EXCLUDED_REVIEWS = [
  "haiku-5.5.json",
  "sonnet-5.5.json",
  "gpt-6-luna.json",
  "blinded-cases.json",
];

type Slot = {
  id: string;
  title: string;
  kind: Kind;
  pass: string | null;
  executed: boolean;
  file: string | null;
};

const SLOTS: readonly Slot[] = [
  { id: "perplexity", title: "Perplexity free", kind: "api", pass: null, executed: false, file: null },
  { id: "parallel", title: "Parallel decisions-fast free", kind: "api", pass: null, executed: false, file: null },
  { id: "jev", title: "Jev 1.14", kind: "api", pass: null, executed: false, file: null },
  { id: "sonnet", title: "Sonnet 5.5", kind: "review", pass: "First pass", executed: false, file: path.join(ROOT, "review/sonnet-5.5-neutral.json") },
  { id: "haiku", title: "Haiku 5.5", kind: "review", pass: "Repaired second pass", executed: false, file: path.join(ROOT, "review/haiku-5.5-neutral.json") },
  { id: "luna", title: "Luna", kind: "review", pass: "First pass", executed: true, file: path.join(ROOT, "review/gpt-6-luna-neutral.json") },
];

type Ratio = { num: number; den: number; value: number | null };
type Confusion = Record<Gold, Record<Action, number>>;
type LabelMatrix = Record<Gold, Record<Gold, number>>;
type Sum = { sum: number; known: number; absent: number };

type Score = {
  cases: number;
  errors: number;
  decided: number;
  pass: number;
  reject: number;
  escalate: number;
  eligible: number;
  falseNegatives: number;
  falsePositives: number;
  confusion: Confusion;
  falseNegativeRate: Ratio;
  gateRecall: Ratio;
  directPass: Ratio;
  passPrecision: Ratio;
  rejectPrecision: Ratio;
  coverage: Ratio;
  directAccuracy: Ratio;
  escalation: Ratio;
  selectiveAccuracy: Ratio;
};

type ProbItem = {
  type: string;
  score?: number;
  noul?: number;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};

type Call = {
  action: Action | null;
  reviewerLabel: Gold | null;
  reason: string | null;
  latencyMs: number | null;
  attempts: number | null;
  httpStatus: number | null;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
  estimateDecisionTokens: number | null;
  estimateBaselineTokens: number | null;
  modelReturned: string | null;
  probabilities: Record<string, ProbItem> | null;
  parts: Record<string, number> | null;
  productionScore: number | null;
};

type Smoke = {
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  modelReturned: string | null;
  httpStatus: number | null;
};

type Source = {
  id: string;
  title: string;
  kind: Kind;
  status: "pending" | "ready" | "partial" | "empty";
  pass: string | null;
  requestedModel: string | null;
  actualModel: string;
  snapshots: string[];
  completedAt: string | null;
  stopFlag: string;
  file: string | null;
  calls: Record<string, Call>;
  smoke: Smoke | null;
  issues: string[];
};

type CaseRow = {
  id: string;
  split: SplitName;
  gold: Gold;
  tags: string[];
  clear: boolean;
};

type Pair = {
  left: string;
  right: string;
  agreement: Ratio;
  disagreements: { id: string; left: Action; right: Action }[];
};

type ApiStats = {
  latencyP50: number | null;
  latencyP95: number | null;
  latencyN: number;
  input: Sum;
  output: Sum;
  cached: Sum;
  reasoning: Sum;
  cost: Sum;
  retries: Sum;
  problems: number;
  answered: number;
  http: string;
  estimateDecision: Sum;
  estimateBaselineAvoided: Sum;
  avoidedCalls: number;
  snapshots: string[];
};

type SliceModel = {
  key: SliceKey;
  label: string;
  size: number;
  commonIds: string[];
  poolIds: string[];
  partialIds: string[];
  same: Record<string, Score>;
  own: Record<string, Score>;
  ownAnswered: Record<string, number>;
  ownAbsent: Record<string, number>;
  labels: Record<string, { matrix: LabelMatrix; correct: number; decided: number; errors: number; accuracy: Ratio } | null>;
  pairs: Pair[];
  api: Record<string, ApiStats | null>;
};

type ReportModel = {
  generator: string;
  generatedAt: string;
  command: string;
  corpus: { cases: number; byLabel: Record<Gold, number>; dev: number; heldout: number; clear: number; heldoutClear: number };
  pending: { id: string; title: string }[];
  ready: { id: string; title: string; status: string }[];
  issues: string[];
  excludedReviews: string[];
  sources: {
    id: string;
    title: string;
    kind: Kind;
    status: string;
    pass: string | null;
    requestedModel: string | null;
    actualModel: string;
    snapshots: string[];
    completedAt: string | null;
    stopFlag: string;
    file: string | null;
    rows: number;
    issues: string[];
  }[];
  slices: SliceModel[];
  cases: (CaseRow & { decisions: Record<string, Call | null> })[];
};

const METHOD = [
  "This report compares three decision APIs and three blinded reviews.",
  "The case set has 42 synthetic cases. The gold labels are hand made. Each gold label has 14 cases.",
  "A gold label is not a real-world label. A rate on this small set is not a real-world rate.",
  "The full set has 42 cases. The held-out set has 24 cases. The dev set is a control. A clear case has the tag clear.",
  "A case is dev when the number in the id modulo 5 is 1 or 2. The other cases are held-out.",
  "The report reads each row. The report does not read a summary block.",
  "Gold comes from benchmarks/fixtures/cases.ts. A reviewer label is not gold.",
  "A false negative is a gold eligible case with action reject.",
  "Gate recall is the count of gold eligible cases with action pass or escalate, divided by gold eligible cases with an action.",
  "Direct pass is the count of gold eligible cases with action pass, divided by gold eligible cases with an action.",
  "Pass precision is the count of pass actions with gold eligible, divided by pass actions.",
  "Reject precision is the count of reject actions with gold ineligible, divided by reject actions.",
  "Coverage is the count of pass and reject actions, divided by answered rows in the set. An error row stays in that denominator.",
  "Direct accuracy uses one map. Eligible maps to pass. Ineligible maps to reject. Ambiguous maps to escalate. The map is a report rule.",
  "Escalation is the count of escalate actions, divided by answered rows in the set.",
  "Selective accuracy uses only pass and reject. A pass is correct only for gold eligible. A reject is correct only for gold ineligible. Escalate stays outside this rate. This rate is not precision.",
  "The rank uses common cases. Each ranked source has an action on each of those cases. A source with no file is pending. Pending is not a score of zero.",
  "A partial source stays out of the rank when a complete source is present. The partial source still has its own denominator.",
  "Each pair uses the cases that both sources decided. A third source does not remove cases from the pair. Agreement is not gold.",
  "The report does not use a majority vote as gold.",
  "Review files in this report use neutral ids. The file neutral-id-map.json maps a neutral id to a fixture id.",
  "Older review files use fixture ids such as e01. Those ids show the gold label. This report does not read those files.",
  "Haiku 5.5 in this report is a repaired second pass. Sonnet 5.5 is a first pass. Luna is a first pass.",
  "The review files set actualModel to null. This report does not invent a model id. The parent says the Luna review did run.",
  "The API answers typed questions. A fixed gate on the worker sets the action. A reviewer assigns a label and an action. The prompts are not the same.",
  "The same 42 fixtures feed both tasks.",
  "Review files have no token counts and no latency. Those cells are N/A. The report does not compare a wall clock with API latency.",
  "Latency p50 is the median. An even count uses the mean of the two middle values. Latency p95 uses the nearest rank at ceil(0.95 * n) - 1.",
  "Measured USD is the usage cost field. A scenario price is a number you type. The report does not add a scenario to measured USD.",
  "An estimate token count uses ceil(chars/4) when the result file stores that estimate. An estimate is not a measured token count.",
  "The gate on an API row is the stored gate. This report does not compute a new gate from probabilities.",
];

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseGold(value: unknown): Gold | null {
  return typeof value === "string" && (GOLD as readonly string[]).includes(value) ? (value as Gold) : null;
}

function parseAction(value: unknown): Action | null {
  return typeof value === "string" && (ACTION as readonly string[]).includes(value) ? (value as Action) : null;
}

function splitOf(id: string): SplitName {
  const n = Number(id.replace(/\D/g, ""));
  if (!Number.isInteger(n)) throw new Error(`bad id ${id}`);
  return n % 5 === 1 || n % 5 === 2 ? "dev" : "heldout";
}

function ratio(num: number, den: number): Ratio {
  if (!den) return { num, den: 0, value: null };
  return { num, den, value: num / den };
}

function emptyConfusion(): Confusion {
  return {
    eligible: { pass: 0, reject: 0, escalate: 0 },
    ineligible: { pass: 0, reject: 0, escalate: 0 },
    ambiguous: { pass: 0, reject: 0, escalate: 0 },
  };
}

function emptyLabels(): LabelMatrix {
  return {
    eligible: { eligible: 0, ineligible: 0, ambiguous: 0 },
    ineligible: { eligible: 0, ineligible: 0, ambiguous: 0 },
    ambiguous: { eligible: 0, ineligible: 0, ambiguous: 0 },
  };
}

function scoreActions(items: readonly { gold: Gold; action: Action | null }[]): Score {
  const confusion = emptyConfusion();
  let errors = 0;
  let pass = 0;
  let reject = 0;
  let escalate = 0;
  let eligible = 0;
  let falseNegatives = 0;
  let falsePositives = 0;
  let direct = 0;
  let eligiblePass = 0;
  let eligibleKeep = 0;
  let passEligible = 0;
  let rejectIneligible = 0;
  let selectiveCorrect = 0;
  for (const item of items) {
    if (item.action === null) {
      errors += 1;
      continue;
    }
    confusion[item.gold][item.action] += 1;
    if (item.action === "pass") pass += 1;
    if (item.action === "reject") reject += 1;
    if (item.action === "escalate") escalate += 1;
    if (item.action === EXPECTED[item.gold]) direct += 1;
    if (item.gold === "eligible") {
      eligible += 1;
      if (item.action === "reject") falseNegatives += 1;
      if (item.action === "pass") eligiblePass += 1;
      if (item.action === "pass" || item.action === "escalate") eligibleKeep += 1;
    }
    if (item.action === "pass" && item.gold === "eligible") passEligible += 1;
    if (item.action === "reject" && item.gold === "ineligible") rejectIneligible += 1;
    if (item.action === "pass" && item.gold === "ineligible") falsePositives += 1;
    if ((item.action === "pass" || item.action === "reject") && ((item.action === "pass" && item.gold === "eligible") || (item.action === "reject" && item.gold === "ineligible"))) {
      selectiveCorrect += 1;
    }
  }
  const cases = items.length;
  const decided = cases - errors;
  return {
    cases,
    errors,
    decided,
    pass,
    reject,
    escalate,
    eligible,
    falseNegatives,
    falsePositives,
    confusion,
    falseNegativeRate: ratio(falseNegatives, eligible),
    gateRecall: ratio(eligibleKeep, eligible),
    directPass: ratio(eligiblePass, eligible),
    passPrecision: ratio(passEligible, pass),
    rejectPrecision: ratio(rejectIneligible, reject),
    coverage: ratio(pass + reject, cases),
    directAccuracy: ratio(direct, decided),
    escalation: ratio(escalate, cases),
    selectiveAccuracy: ratio(selectiveCorrect, pass + reject),
  };
}

function scoreLabels(items: readonly { gold: Gold; label: Gold | null }[]) {
  const matrix = emptyLabels();
  let errors = 0;
  let correct = 0;
  for (const item of items) {
    if (item.label === null) {
      errors += 1;
      continue;
    }
    matrix[item.gold][item.label] += 1;
    if (item.label === item.gold) correct += 1;
  }
  const decided = items.length - errors;
  return { matrix, correct, decided, errors, accuracy: ratio(correct, decided) };
}

function sumKnown(values: readonly (number | null)[]): Sum {
  let sum = 0;
  let known = 0;
  let absent = 0;
  for (const value of values) {
    if (value === null) absent += 1;
    else {
      sum += value;
      known += 1;
    }
  }
  return { sum, known, absent };
}

function measured(stat: Sum): number | null {
  return stat.known === 0 ? null : stat.sum;
}

function percentile(sorted: readonly number[], p: number): number | null {
  const n = sorted.length;
  if (!n) return null;
  if (p === 0.5) {
    const mid = Math.floor(n / 2);
    return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  const index = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
  return sorted[index];
}

function orderByRecall(rows: readonly { id: string; recall: number | null }[]): { id: string; rank: number | null }[] {
  const ranked = rows.filter((row) => row.recall !== null).sort((a, b) => (b.recall as number) - (a.recall as number) || a.id.localeCompare(b.id));
  const rest = rows.filter((row) => row.recall === null);
  return [...ranked.map((row, index) => ({ id: row.id, rank: index + 1 })), ...rest.map((row) => ({ id: row.id, rank: null }))];
}

function auditScore(score: Score, name: string) {
  check(score.pass + score.reject + score.escalate + score.errors === score.cases, `${name} partition`);
  check(score.decided + score.errors === score.cases, `${name} decided`);
  check(score.falseNegatives === score.confusion.eligible.reject, `${name} fn`);
  check(score.falsePositives === score.confusion.ineligible.pass, `${name} fp`);
  check(score.gateRecall.num === score.confusion.eligible.pass + score.confusion.eligible.escalate, `${name} keep`);
  check(score.gateRecall.den === score.eligible, `${name} eligible`);
  check(score.coverage.num === score.pass + score.reject, `${name} coverage`);
  check(score.coverage.den === score.cases, `${name} coverage den`);
  check(score.escalation.num === score.escalate, `${name} escalation`);
  check(score.directAccuracy.den === score.decided, `${name} direct`);
  check(score.selectiveAccuracy.den === score.pass + score.reject, `${name} selective`);
  let cells = 0;
  for (const gold of GOLD) for (const action of ACTION) cells += score.confusion[gold][action];
  check(cells === score.decided, `${name} cells`);
}

function selfCheck() {
  check(splitOf("e01") === "dev", "e01 dev");
  check(splitOf("e03") === "heldout", "e03 heldout");
  check(splitOf("a01") === "dev", "a01 dev");
  check(splitOf("n05") === "heldout", "n05 heldout");
  check(parseAction("pass") === "pass", "pass");
  check(parseAction("yes") === null, "bad action");
  check(parseGold("eligible") === "eligible", "gold");
  check(parseGold("pass") === null, "bad gold");
  const toy = scoreActions([
    { gold: "eligible", action: "pass" },
    { gold: "eligible", action: "reject" },
    { gold: "eligible", action: "escalate" },
    { gold: "ineligible", action: "pass" },
    { gold: "ineligible", action: "reject" },
    { gold: "ambiguous", action: "escalate" },
    { gold: "ambiguous", action: "pass" },
    { gold: "eligible", action: null },
  ]);
  auditScore(toy, "toy");
  check(toy.falseNegatives === 1 && toy.falseNegativeRate.num === 1 && toy.falseNegativeRate.den === 3, "toy fn");
  check(toy.gateRecall.num === 2 && toy.gateRecall.den === 3, "toy recall");
  check(toy.directPass.num === 1 && toy.directPass.den === 3, "toy direct pass");
  check(toy.falsePositives === 1, "toy fp");
  check(toy.passPrecision.num === 1 && toy.passPrecision.den === 3, "toy pass precision");
  check(toy.rejectPrecision.num === 1 && toy.rejectPrecision.den === 2, "toy reject precision");
  check(toy.coverage.num === 5 && toy.coverage.den === 8, "toy coverage");
  check(toy.escalation.num === 2 && toy.escalation.den === 8, "toy escalation");
  check(toy.directAccuracy.num === 3 && toy.directAccuracy.den === 7, "toy direct");
  check(toy.selectiveAccuracy.num === 2 && toy.selectiveAccuracy.den === 5, "toy selective");
  check(toy.errors === 1 && toy.eligible === 3, "toy errors");
  const labels = scoreLabels([
    { gold: "ineligible", label: "eligible" },
    { gold: "eligible", label: "eligible" },
    { gold: "ambiguous", label: null },
  ]);
  check(labels.accuracy.num === 1 && labels.accuracy.den === 2, "label accuracy");
  check(labels.matrix.ineligible.eligible === 1, "label cell");
  check(labels.errors === 1, "label error");
  const zeros = sumKnown([null, null]);
  const realZero = sumKnown([0, 0]);
  check(measured(zeros) === null, "absent is not zero");
  check(measured(realZero) === 0 && realZero.known === 2, "real zero stays");
  check(percentile([10, 20, 30, 40], 0.5) === 25, "p50");
  check(percentile([10, 20, 30, 40], 0.95) === 40, "p95");
  check(percentile([10, 20, 30], 0.5) === 20, "p50 odd");
  check(percentile([], 0.5) === null, "p50 empty");
  const order = orderByRecall([
    { id: "b", recall: null },
    { id: "a", recall: 0 },
    { id: "c", recall: 0.5 },
  ]);
  check(order.map((row) => `${row.id}:${row.rank}`).join(",") === "c:1,a:2,b:null", "rank skips null");
  check(classifyApi("results.json", { modelRequested: "perplexity/pplx-decider-v1.3:free", harness: "jev state" }) === "perplexity", "pplx first");
  check(classifyApi("x.json", { modelRequested: "parallel/decisions-fast:free" }) === "parallel", "parallel id");
  check(classifyApi("jev.json", { rows: [{ modelReturned: "jev-1.14.0" }] }) === "jev", "jev id");
  check(classifyApi("notes.json", { harness: "not a model" }) === null, "unknown file");
  const older = { file: "results.json", rows: 42, doc: { completedAt: "2026-11-12T20:09:08.020Z" } };
  const newer = { file: "perplexity-pplx-decider-v1.3-free.json", rows: 42, doc: { completedAt: "2026-11-12T20:31:21.553Z" } };
  check(preferHit(newer, older) === true, "newer run");
  check(preferHit(older, newer) === false, "older run");
  check(preferHit({ file: "a.json", rows: 10, doc: { completedAt: "2026-11-12T23:00:00.000Z" } }, { file: "b.json", rows: 42, doc: { completedAt: "2026-11-12T20:00:00.000Z" } }) === false, "row count wins");
}

type Hit = { file: string; doc: Record<string, unknown>; rows: number };

function completedMs(doc: Record<string, unknown>): number {
  const time = Date.parse(str(doc.completedAt));
  return Number.isFinite(time) ? time : 0;
}

function preferHit(next: Hit, prev: Hit): boolean {
  if (next.rows !== prev.rows) return next.rows > prev.rows;
  const nextTime = completedMs(next.doc);
  const prevTime = completedMs(prev.doc);
  if (nextTime !== prevTime) return nextTime > prevTime;
  return path.basename(prev.file) === "results.json" && path.basename(next.file) !== "results.json";
}

function skipNote(id: string, loser: Hit, winner: Hit): string {
  const loserName = path.basename(loser.file);
  const winnerName = path.basename(winner.file);
  if (loser.rows !== winner.rows) return `${id}: ${loserName} has ${loser.rows} rows. The report uses ${winnerName} (${winner.rows} rows).`;
  return `${id}: ${loserName} is an older run. The report uses ${winnerName}.`;
}

function classifyApi(file: string, doc: Record<string, unknown>): string | null {
  const bits = [path.basename(file), str(doc.modelRequested), str(doc.requestedModel), str(doc.requestModel), str(doc.canonicalSnapshot), str(doc.harness)];
  if (isRecord(doc.catalog)) bits.push(str(doc.catalog.providerName));
  const rows = Array.isArray(doc.rows) ? doc.rows : [];
  const first = rows.find(isRecord);
  if (first) bits.push(str(first.modelRequested), str(first.modelReturned), str(first.provider));
  const blob = bits.join(" ").toLowerCase();
  if (blob.includes("pplx") || blob.includes("perplexity")) return "perplexity";
  if (blob.includes("decisions-fast") || blob.includes("parallel")) return "parallel";
  if (blob.includes("jev-1.14") || /(?:^|[^a-z])jev(?:[^a-z]|$)/.test(blob)) return "jev";
  return null;
}

function numericRecord(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
  }
  return Object.keys(out).length ? out : null;
}

function compactAnswers(value: unknown): Record<string, ProbItem> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, ProbItem> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw) || typeof raw.type !== "string") continue;
    if (raw.type !== "score" && raw.type !== "choice" && raw.type !== "noul") continue;
    const item: ProbItem = { type: raw.type };
    const score = numOrNull(raw.score);
    const noul = numOrNull(raw.noul);
    const confidence = numOrNull(raw.confidence);
    if (score !== null) item.score = score;
    if (noul !== null) item.noul = noul;
    if (typeof raw.choice === "string") item.choice = raw.choice;
    if (confidence !== null) item.confidence = confidence;
    const probabilities = numericRecord(raw.probabilities);
    if (probabilities) item.probabilities = probabilities;
    out[key] = item;
  }
  return Object.keys(out).length ? out : null;
}

function compactParts(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, number> = {};
  for (const key of ["requirements", "work", "seniority", "place", "language", "thin"]) {
    const n = numOrNull(value[key]);
    if (n !== null) out[key] = n;
  }
  return Object.keys(out).length ? out : null;
}

function blankCall(): Call {
  return {
    action: null,
    reviewerLabel: null,
    reason: null,
    latencyMs: null,
    attempts: null,
    httpStatus: null,
    error: null,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    reasoningTokens: null,
    costUsd: null,
    estimateDecisionTokens: null,
    estimateBaselineTokens: null,
    modelReturned: null,
    probabilities: null,
    parts: null,
    productionScore: null,
  };
}

function callFromApiRow(row: Record<string, unknown>): Call {
  const call = blankCall();
  call.action = parseAction(row.gate ?? row.action);
  const usage = isRecord(row.usage) ? row.usage : null;
  call.inputTokens = usage ? numOrNull(usage.inputTokens) : null;
  call.outputTokens = usage ? numOrNull(usage.outputTokens) : null;
  call.cachedTokens = usage ? numOrNull(usage.cachedTokens) : null;
  call.reasoningTokens = usage ? numOrNull(usage.reasoningTokens) : null;
  call.costUsd = usage ? numOrNull(usage.costUsd) : null;
  call.latencyMs = numOrNull(row.latencyMs);
  call.attempts = numOrNull(row.attempts);
  call.httpStatus = numOrNull(row.httpStatus);
  call.error = typeof row.error === "string" && row.error.trim() ? row.error.trim() : null;
  call.modelReturned = typeof row.modelReturned === "string" && row.modelReturned.trim() ? row.modelReturned.trim() : null;
  call.probabilities = compactAnswers(row.answers);
  call.parts = compactParts(row.parts);
  call.productionScore = numOrNull(row.productionScore);
  if (isRecord(row.simulated)) {
    call.estimateDecisionTokens = numOrNull(row.simulated.decisionTokens);
    call.estimateBaselineTokens = numOrNull(row.simulated.baselineTokens);
  }
  if (call.action === null && !call.error) call.error = "no gate";
  return call;
}

function smokeFrom(value: unknown): Smoke | null {
  if (!isRecord(value)) return null;
  const usage = isRecord(value.usage) ? value.usage : null;
  return {
    latencyMs: numOrNull(value.latencyMs),
    inputTokens: usage ? numOrNull(usage.inputTokens) : null,
    outputTokens: usage ? numOrNull(usage.outputTokens) : null,
    costUsd: usage ? numOrNull(usage.costUsd) : null,
    modelReturned: typeof value.modelReturned === "string" ? value.modelReturned : null,
    httpStatus: numOrNull(value.httpStatus),
  };
}

function stopFlag(value: unknown): string {
  if (value === null) return "none";
  if (typeof value === "string" && value.trim()) return value.trim();
  return "absent";
}

function actualModelNote(slot: Slot, doc: Record<string, unknown>): string {
  const actual = typeof doc.actualModel === "string" ? doc.actualModel.trim() : "";
  if (actual) return actual;
  if (slot.executed) return "Unknown in the file. The parent says this review did run.";
  if (slot.kind === "review") return "Unknown";
  const returned = typeof doc.canonicalSnapshot === "string" && doc.canonicalSnapshot.trim() ? doc.canonicalSnapshot.trim() : "";
  return returned || "See snapshot";
}

function walkJson(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJson(full));
    else if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== "comparison.json") out.push(full);
  }
  return out;
}

function readJson(file: string): { doc?: Record<string, unknown>; error?: string } {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (Array.isArray(parsed)) {
      const docs = parsed.filter(isRecord);
      if (docs.length === 1) return { doc: docs[0] };
      return { error: `${path.basename(file)} has ${docs.length} records` };
    }
    if (!isRecord(parsed)) return { error: `${path.basename(file)} is not an object` };
    return { doc: parsed };
  } catch {
    return { error: `${path.basename(file)} did not parse` };
  }
}

function emptySource(slot: Slot, status: Source["status"], issue: string | null): Source {
  return {
    id: slot.id,
    title: slot.title,
    kind: slot.kind,
    status,
    pass: slot.pass,
    requestedModel: null,
    actualModel: slot.kind === "review" ? (slot.executed ? "Unknown in the file. The parent says this review did run." : "Unknown") : "Absent",
    snapshots: [],
    completedAt: null,
    stopFlag: "absent",
    file: null,
    calls: {},
    smoke: null,
    issues: issue ? [issue] : [],
  };
}

function loadApi(slot: Slot, file: string, doc: Record<string, unknown>, fixtures: Map<string, Fixture>): Source {
  const source = emptySource(slot, "empty", null);
  source.file = file;
  source.requestedModel = str(doc.modelRequested) || str(doc.requestedModel) || str(doc.requestModel) || null;
  source.completedAt = typeof doc.completedAt === "string" ? doc.completedAt : null;
  source.stopFlag = stopFlag(doc.stopped);
  source.smoke = smokeFrom(doc.smoke);
  const snapshot = typeof doc.canonicalSnapshot === "string" ? doc.canonicalSnapshot : "";
  if (snapshot) source.snapshots.push(snapshot);
  source.actualModel = actualModelNote(slot, doc);
  const rows = Array.isArray(doc.rows) ? doc.rows : [];
  const seen = new Set<string>();
  for (const raw of rows) {
    if (!isRecord(raw) || typeof raw.id !== "string") {
      source.issues.push("A row has no id");
      continue;
    }
    if (!fixtures.has(raw.id)) {
      source.issues.push(`${raw.id} is not a fixture id`);
      continue;
    }
    if (seen.has(raw.id)) {
      source.issues.push(`${raw.id} is a duplicate row`);
      continue;
    }
    seen.add(raw.id);
    const call = callFromApiRow(raw);
    source.calls[raw.id] = call;
    if (call.modelReturned && !source.snapshots.includes(call.modelReturned)) source.snapshots.push(call.modelReturned);
  }
  const n = Object.keys(source.calls).length;
  source.status = n === 0 ? "empty" : n === fixtures.size ? "ready" : "partial";
  return source;
}

function loadReview(slot: Slot, doc: Record<string, unknown>, map: Record<string, string>, fixtures: Map<string, Fixture>): Source {
  const source = emptySource(slot, "empty", null);
  source.file = slot.file;
  source.requestedModel = str(doc.requestedModel) || null;
  source.actualModel = actualModelNote(slot, doc);
  source.completedAt = typeof doc.completedAt === "string" ? doc.completedAt : null;
  source.stopFlag = "absent";
  const rows = Array.isArray(doc.cases) ? doc.cases : [];
  const seen = new Set<string>();
  for (const raw of rows) {
    if (!isRecord(raw) || typeof raw.id !== "string") {
      source.issues.push("A review row has no id");
      continue;
    }
    if (/^(e|n|a)\d+$/.test(raw.id)) {
      source.issues.push(`${raw.id} is a fixture id in a neutral file. The row is excluded.`);
      continue;
    }
    const fixtureId = map[raw.id];
    if (!fixtureId || !fixtures.has(fixtureId)) {
      source.issues.push(`${raw.id} has no fixture in the neutral map`);
      continue;
    }
    if (seen.has(fixtureId)) {
      source.issues.push(`${fixtureId} is a duplicate review`);
      continue;
    }
    seen.add(fixtureId);
    const call = blankCall();
    call.action = parseAction(raw.action);
    call.reviewerLabel = parseGold(raw.label);
    call.reason = typeof raw.reason === "string" ? raw.reason : null;
    if (call.action === null) call.error = "bad action";
    if (call.reviewerLabel === null) call.error = call.error ? `${call.error}; bad label` : "bad label";
    source.calls[fixtureId] = call;
  }
  const n = Object.keys(source.calls).length;
  source.status = n === 0 ? "empty" : n === fixtures.size ? "ready" : "partial";
  return source;
}

function loadMap(file: string): { map: Record<string, string>; issues: string[] } {
  const issues: string[] = [];
  const read = readJson(file);
  if (!read.doc) return { map: {}, issues: [read.error ?? "neutral map absent"] };
  const map: Record<string, string> = {};
  const values = new Set<string>();
  for (const [key, value] of Object.entries(read.doc)) {
    if (typeof value !== "string") {
      issues.push(`${key} does not map to an id`);
      continue;
    }
    if (values.has(value)) issues.push(`${value} is a duplicate map value`);
    values.add(value);
    map[key] = value;
  }
  return { map, issues };
}

function discoverApis(fixtures: Map<string, Fixture>, issues: string[]): Map<string, Source> {
  const found = new Map<string, Hit>();
  for (const file of walkJson(OUT_DIR)) {
    const read = readJson(file);
    if (!read.doc) {
      issues.push(read.error ?? "bad json");
      continue;
    }
    const id = classifyApi(file, read.doc);
    if (!id) {
      const rows = Array.isArray(read.doc.rows) ? read.doc.rows : [];
      if (rows.some((row) => isRecord(row) && (row.gate != null || row.action != null))) {
        issues.push(`${path.basename(file)} has decision rows and no known model id`);
      }
      continue;
    }
    const hit: Hit = { file, doc: read.doc, rows: Array.isArray(read.doc.rows) ? read.doc.rows.length : 0 };
    const prev = found.get(id);
    if (!prev || preferHit(hit, prev)) {
      if (prev) issues.push(skipNote(id, prev, hit));
      found.set(id, hit);
    } else {
      issues.push(skipNote(id, hit, prev));
    }
  }
  const sources = new Map<string, Source>();
  for (const slot of SLOTS.filter((item) => item.kind === "api")) {
    const hit = found.get(slot.id);
    sources.set(slot.id, hit ? loadApi(slot, hit.file, hit.doc, fixtures) : emptySource(slot, "pending", "Result file absent"));
  }
  return sources;
}

function sliceIds(cases: readonly CaseRow[], key: SliceKey): string[] {
  if (key === "all") return cases.map((row) => row.id);
  if (key === "heldout") return cases.filter((row) => row.split === "heldout").map((row) => row.id);
  if (key === "dev") return cases.filter((row) => row.split === "dev").map((row) => row.id);
  if (key === "clear") return cases.filter((row) => row.clear).map((row) => row.id);
  return cases.filter((row) => row.split === "heldout" && row.clear).map((row) => row.id);
}

function sliceLabel(key: SliceKey, n: number): string {
  if (key === "all") return `All (${n})`;
  if (key === "heldout") return `Held-out (${n})`;
  if (key === "dev") return `Dev (${n})`;
  if (key === "clear") return `Clear tag (${n})`;
  return `Held-out and clear (${n})`;
}

function itemsFor(source: Source, ids: readonly string[], goldOf: Map<string, Gold>, mode: "present-action" | "answered") {
  const items: { id: string; gold: Gold; action: Action | null }[] = [];
  for (const id of ids) {
    const call = source.calls[id];
    if (!call) continue;
    if (mode === "present-action" && call.action === null) continue;
    const gold = goldOf.get(id);
    if (!gold) continue;
    items.push({ id, gold, action: call.action });
  }
  return items;
}

function apiStats(source: Source, ids: readonly string[]): ApiStats {
  const calls = ids.map((id) => source.calls[id]).filter((call): call is Call => Boolean(call));
  const latency = calls.map((call) => call.latencyMs).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const http = new Map<string, number>();
  let problems = 0;
  let avoided = 0;
  for (const call of calls) {
    const key = call.httpStatus === null ? "absent" : String(call.httpStatus);
    http.set(key, (http.get(key) ?? 0) + 1);
    const badHttp = call.httpStatus !== null && call.httpStatus !== 200;
    if (call.action === null || call.error || badHttp) problems += 1;
    if (call.action === "pass" || call.action === "reject") avoided += 1;
  }
  const retryValues = calls.map((call) => (call.attempts === null ? null : Math.max(0, call.attempts - 1)));
  const snapshots = [...new Set(calls.map((call) => call.modelReturned).filter((value): value is string => Boolean(value)))];
  return {
    latencyP50: percentile(latency, 0.5),
    latencyP95: percentile(latency, 0.95),
    latencyN: latency.length,
    input: sumKnown(calls.map((call) => call.inputTokens)),
    output: sumKnown(calls.map((call) => call.outputTokens)),
    cached: sumKnown(calls.map((call) => call.cachedTokens)),
    reasoning: sumKnown(calls.map((call) => call.reasoningTokens)),
    cost: sumKnown(calls.map((call) => call.costUsd)),
    retries: sumKnown(retryValues),
    problems,
    answered: calls.length,
    http: [...http.entries()].map(([code, n]) => `${code} on ${n}`).join(", ") || "absent",
    estimateDecision: sumKnown(calls.map((call) => call.estimateDecisionTokens)),
    estimateBaselineAvoided: sumKnown(calls.filter((call) => call.action === "pass" || call.action === "reject").map((call) => call.estimateBaselineTokens)),
    avoidedCalls: avoided,
    snapshots,
  };
}

function buildSlice(key: SliceKey, cases: readonly CaseRow[], sources: readonly Source[], goldOf: Map<string, Gold>): SliceModel {
  const ids = sliceIds(cases, key);
  const present = sources.filter((source) => source.status !== "pending" && Object.keys(source.calls).length > 0);
  const complete = present.filter((source) => ids.every((id) => source.calls[id]));
  const pool = complete.length ? complete : present;
  const commonIds = ids.filter((id) => pool.every((source) => source.calls[id]?.action));
  const partialIds = present.filter((source) => !pool.includes(source)).map((source) => source.id);
  const same: SliceModel["same"] = {};
  const own: SliceModel["own"] = {};
  const ownAnswered: Record<string, number> = {};
  const ownAbsent: Record<string, number> = {};
  const labels: SliceModel["labels"] = {};
  const api: SliceModel["api"] = {};
  for (const source of sources) {
    if (source.status === "pending") continue;
    const ownItems = itemsFor(source, ids, goldOf, "answered");
    own[source.id] = scoreActions(ownItems);
    ownAnswered[source.id] = ownItems.length;
    ownAbsent[source.id] = ids.length - ownItems.length;
    if (pool.includes(source)) same[source.id] = scoreActions(itemsFor(source, commonIds, goldOf, "present-action"));
    if (source.kind === "review") {
      const labelItems = ids.flatMap((id) => {
        const call = source.calls[id];
        const gold = goldOf.get(id);
        if (!call || !gold) return [];
        return [{ gold, label: call.reviewerLabel }];
      });
      labels[source.id] = scoreLabels(labelItems);
    } else {
      labels[source.id] = null;
    }
    api[source.id] = source.kind === "api" ? apiStats(source, ids) : null;
  }
  const pairs: Pair[] = [];
  for (let i = 0; i < present.length; i += 1) {
    for (let j = i + 1; j < present.length; j += 1) {
      const left = present[i];
      const right = present[j];
      const shared = ids.filter((id) => left.calls[id]?.action && right.calls[id]?.action);
      let agree = 0;
      const disagreements: Pair["disagreements"] = [];
      for (const id of shared) {
        const a = left.calls[id].action as Action;
        const b = right.calls[id].action as Action;
        if (a === b) agree += 1;
        else disagreements.push({ id, left: a, right: b });
      }
      pairs.push({ left: left.id, right: right.id, agreement: ratio(agree, shared.length), disagreements });
    }
  }
  return {
    key,
    label: sliceLabel(key, ids.length),
    size: ids.length,
    commonIds,
    poolIds: pool.map((source) => source.id),
    partialIds,
    same,
    own,
    ownAnswered,
    ownAbsent,
    labels,
    pairs,
    api,
  };
}

function assertCorpus(cases: readonly Fixture[]) {
  const ids = cases.map((item) => item.id);
  check(ids.length === 42 && new Set(ids).size === 42, "corpus is not 42 unique cases");
  for (const label of GOLD) check(cases.filter((item) => item.label === label).length === 14, `${label} count`);
  check(cases.filter((item) => splitOf(item.id) === "heldout").length === 24, "held-out count");
  check(cases.filter((item) => splitOf(item.id) === "dev").length === 18, "dev count");
  const blob = JSON.stringify(cases);
  check(!blob.includes("@"), "corpus has @");
}

function build(): { model: ReportModel; sources: Source[]; fixtures: Map<string, Fixture> } {
  assertCorpus(CASES);
  const fixtures = new Map(CASES.map((item) => [item.id, item]));
  const issues: string[] = [];
  const mapFile = path.join(ROOT, "review/neutral-id-map.json");
  const loadedMap = existsSync(mapFile) ? loadMap(mapFile) : { map: {}, issues: ["neutral-id-map.json is absent"] };
  issues.push(...loadedMap.issues);
  const mapValues = new Set(Object.values(loadedMap.map));
  for (const id of fixtures.keys()) {
    if (!mapValues.has(id)) issues.push(`${id} is absent from the neutral map`);
  }
  const sources = [...discoverApis(fixtures, issues).values()];
  for (const slot of SLOTS.filter((item) => item.kind === "review")) {
    if (!slot.file || !existsSync(slot.file)) {
      sources.push(emptySource(slot, "pending", "Neutral review file absent"));
      continue;
    }
    const read = readJson(slot.file);
    if (!read.doc) {
      const empty = emptySource(slot, "empty", read.error ?? "review did not parse");
      empty.file = slot.file;
      sources.push(empty);
      continue;
    }
    sources.push(loadReview(slot, read.doc, loadedMap.map, fixtures));
  }
  const cases: CaseRow[] = CASES.map((item) => ({
    id: item.id,
    split: splitOf(item.id),
    gold: item.label,
    tags: [...item.tags],
    clear: item.tags.includes("clear"),
  }));
  const goldOf = new Map(cases.map((row) => [row.id, row.gold]));
  const byLabel = { eligible: 0, ineligible: 0, ambiguous: 0 };
  for (const row of cases) byLabel[row.gold] += 1;
  const slices = SLICE_KEYS.map((key) => buildSlice(key, cases, sources, goldOf));
  for (const slice of slices) {
    for (const [id, score] of Object.entries(slice.same)) auditScore(score, `${slice.key} same ${id}`);
    for (const [id, score] of Object.entries(slice.own)) auditScore(score, `${slice.key} own ${id}`);
    for (const [id, block] of Object.entries(slice.labels)) {
      if (!block) continue;
      let cells = 0;
      for (const gold of GOLD) for (const label of GOLD) cells += block.matrix[gold][label];
      check(cells === block.decided, `${slice.key} labels ${id}`);
    }
  }
  const sourceViews = sources.map((source) => ({
    id: source.id,
    title: source.title,
    kind: source.kind,
    status: source.status,
    pass: source.pass,
    requestedModel: source.requestedModel,
    actualModel: source.actualModel,
    snapshots: source.snapshots,
    completedAt: source.completedAt,
    stopFlag: source.stopFlag,
    file: source.file ? path.relative(OUT_DIR, source.file).split(path.sep).join("/") : null,
    rows: Object.keys(source.calls).length,
    issues: source.issues,
  }));
  for (const source of sources) issues.push(...source.issues.map((issue) => `${source.title}: ${issue}`));
  const caseViews = cases.map((row) => {
    const decisions: Record<string, Call | null> = {};
    for (const source of sources) {
      if (source.status === "pending") continue;
      decisions[source.id] = source.calls[row.id] ?? null;
    }
    return { ...row, decisions };
  });
  const model: ReportModel = {
    generator: GENERATOR,
    generatedAt: new Date().toISOString(),
    command: "npx tsx benchmarks/render-comparison.ts",
    corpus: {
      cases: cases.length,
      byLabel,
      dev: cases.filter((row) => row.split === "dev").length,
      heldout: cases.filter((row) => row.split === "heldout").length,
      clear: cases.filter((row) => row.clear).length,
      heldoutClear: cases.filter((row) => row.clear && row.split === "heldout").length,
    },
    pending: sources.filter((source) => source.status === "pending").map((source) => ({ id: source.id, title: source.title })),
    ready: sources.filter((source) => source.status !== "pending").map((source) => ({ id: source.id, title: source.title, status: source.status })),
    issues: issues.slice(0, 40).concat(issues.length > 40 ? [`${issues.length - 40} more issues`] : []),
    excludedReviews: EXCLUDED_REVIEWS.filter((name) => existsSync(path.join(ROOT, "review", name))),
    sources: sourceViews,
    slices,
    cases: caseViews,
  };
  return { model, sources, fixtures };
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtRatio(r: Ratio | undefined): string {
  if (!r || r.value === null) return "N/A";
  return `${r.num}/${r.den} (${r.value.toFixed(3)})`;
}

function fmtKnown(stat: Sum | undefined): string {
  if (!stat || stat.known === 0) return "N/A";
  if (stat.absent === 0) return String(stat.sum);
  return `${stat.sum} (${stat.known} known, ${stat.absent} absent)`;
}

function fmtMs(value: number | null): string {
  if (value === null) return "N/A";
  return Number.isInteger(value) ? `${value} ms` : `${value.toFixed(1)} ms`;
}

function fmtMoney(stat: Sum | undefined): string {
  if (!stat || stat.known === 0) return "N/A";
  return stat.sum === 0 ? `0 (${stat.known} known)` : `${stat.sum} (${stat.known} known, ${stat.absent} absent)`;
}

function sourceById(sources: readonly Source[], id: string): Source {
  const source = sources.find((item) => item.id === id);
  if (!source) throw new Error(`no source ${id}`);
  return source;
}

function gateTable(score: Score): string {
  const head = ACTION.map((action) => `<th scope="col">${action}</th>`).join("");
  const body = GOLD.map((gold) => `<tr><th scope="row">${gold}</th>${ACTION.map((action) => `<td class="num">${score.confusion[gold][action]}</td>`).join("")}</tr>`).join("");
  return `<table><caption>Gate confusion. The row is the gold label. The column is the action.</caption><thead><tr><th scope="col">Gold</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function labelTable(block: NonNullable<SliceModel["labels"][string]>): string {
  const head = GOLD.map((label) => `<th scope="col">${label}</th>`).join("");
  const body = GOLD.map((gold) => `<tr><th scope="row">${gold}</th>${GOLD.map((label) => `<td class="num">${block.matrix[gold][label]}</td>`).join("")}</tr>`).join("");
  return `<table><caption>Label confusion. The row is gold. The column is the reviewer label. Agreement with gold is ${fmtRatio(block.accuracy)}.</caption><thead><tr><th scope="col">Gold</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

type Bar = { label: string; value: number | null; text: string; color: string };

function hBars(id: string, title: string, desc: string, bars: readonly Bar[], max: number): string {
  if (!bars.length) return `<p>No measured bars. A source with no data is not a zero bar.</p>`;
  const rowH = 28;
  const left = 250;
  const plot = 300;
  const width = 760;
  const height = bars.length * rowH + 42;
  const ticks = [0, 0.25, 0.5, 0.75, 1].filter((tick) => tick <= max + 1e-9);
  const axisY = height - 22;
  const tickMarks = ticks
    .map((tick) => {
      const x = left + (max === 0 ? 0 : (tick / max) * plot);
      return `<line x1="${x}" y1="${axisY}" x2="${x}" y2="${axisY + 4}" stroke="currentColor"/><text x="${x}" y="${axisY + 16}" text-anchor="middle" fill="currentColor" font-size="11">${tick}</text>`;
    })
    .join("");
  const rows = bars
    .map((bar, index) => {
      const y = 8 + index * rowH;
      const w = bar.value === null || max === 0 ? 0 : (bar.value / max) * plot;
      const rect = bar.value === null ? "" : `<rect x="${left}" y="${y + 4}" width="${w.toFixed(2)}" height="16" fill="${bar.color}"/>`;
      return `${rect}<text x="${left - 8}" y="${y + 16}" text-anchor="end" fill="currentColor" font-size="12">${esc(bar.label)}</text><text x="${left + plot + 8}" y="${y + 16}" fill="currentColor" font-size="12">${esc(bar.text)}</text>`;
    })
    .join("");
  return `<figure class="chart"><svg role="img" aria-labelledby="${id}-title ${id}-desc" viewBox="0 0 ${width} ${height}" width="100%">${`<title id="${id}-title">${esc(title)}</title><desc id="${id}-desc">${esc(desc)}</desc>`}<line x1="${left}" y1="${axisY}" x2="${left + plot}" y2="${axisY}" stroke="currentColor"/>${tickMarks}${rows}</svg><figcaption>${esc(title)}. ${esc(desc)}</figcaption></figure>`;
}

function stackChart(id: string, rows: readonly { label: string; pass: number; reject: number; escalate: number }[]): string {
  if (!rows.length) return `<p>No common cases for the count chart.</p>`;
  const max = Math.max(1, ...rows.map((row) => row.pass + row.reject + row.escalate));
  const rowH = 32;
  const left = 180;
  const plot = 360;
  const width = 760;
  const height = rows.length * rowH + 42;
  const axisY = height - 22;
  const colors = { pass: "var(--bar-1)", reject: "var(--bar-3)", escalate: "var(--bar-2)" };
  const body = rows
    .map((row, index) => {
      const y = 8 + index * rowH;
      let x = left;
      const parts = (["pass", "reject", "escalate"] as const).map((name) => {
        const value = row[name];
        const w = (value / max) * plot;
        const rect = value ? `<rect x="${x.toFixed(2)}" y="${y + 6}" width="${w.toFixed(2)}" height="16" fill="${colors[name]}"><title>${name} ${value}</title></rect>` : "";
        x += w;
        return rect;
      });
      const total = row.pass + row.reject + row.escalate;
      return `${parts.join("")}<text x="${left - 8}" y="${y + 18}" text-anchor="end" fill="currentColor" font-size="12">${esc(row.label)}</text><text x="${left + plot + 8}" y="${y + 18}" fill="currentColor" font-size="12">${total} cases</text>`;
    })
    .join("");
  const ticks = [0, Math.round(max / 2), max];
  const tickMarks = [...new Set(ticks)]
    .map((tick) => {
      const x = left + (tick / max) * plot;
      return `<line x1="${x}" y1="${axisY}" x2="${x}" y2="${axisY + 4}" stroke="currentColor"/><text x="${x}" y="${axisY + 16}" text-anchor="middle" fill="currentColor" font-size="11">${tick}</text>`;
    })
    .join("");
  return `<figure class="chart"><svg role="img" aria-labelledby="${id}-title ${id}-desc" viewBox="0 0 ${width} ${height}" width="100%"><title id="${id}-title">Action counts</title><desc id="${id}-desc">Stacked counts of pass, reject, and escalate. The axis starts at 0. A pending source is not on this chart.</desc><line x1="${left}" y1="${axisY}" x2="${left + plot}" y2="${axisY}" stroke="currentColor"/>${tickMarks}${body}</svg><figcaption>Action counts on the common cases. Pass, reject, then escalate. The axis is a count and starts at 0.</figcaption></figure>`;
}

const RATE_COLORS = ["var(--bar-1)", "var(--bar-2)", "var(--bar-3)", "var(--bar-4)"];

function rateChart(slice: SliceModel, sources: readonly Source[]): string {
  const metrics: { key: keyof Score; label: string }[] = [
    { key: "gateRecall", label: "Gate recall" },
    { key: "directAccuracy", label: "Direct accuracy" },
    { key: "coverage", label: "Coverage" },
    { key: "escalation", label: "Escalation" },
  ];
  const bars: Bar[] = [];
  for (const id of slice.poolIds) {
    const score = slice.same[id];
    if (!score) continue;
    metrics.forEach((metric, index) => {
      const rate = score[metric.key] as Ratio;
      bars.push({
        label: `${sourceById(sources, id).title} · ${metric.label}`,
        value: rate.value,
        text: fmtRatio(rate),
        color: RATE_COLORS[index],
      });
    });
  }
  return hBars(
    `${slice.key}-rates`,
    "Rates on the common cases",
    "The axis is a rate from 0 to 1. A bar of 0 is a measured zero. N/A is not a bar. Escalation is a rate, not a quality score.",
    bars,
    1,
  );
}

function latencyChart(slice: SliceModel, sources: readonly Source[]): string {
  const bars: Bar[] = [];
  let max = 0;
  for (const source of sources) {
    const stats = slice.api[source.id];
    if (!stats || source.kind !== "api") continue;
    if (stats.latencyP50 === null && stats.latencyP95 === null) continue;
    if (stats.latencyP50 !== null) {
      bars.push({ label: `${source.title} · p50`, value: stats.latencyP50, text: fmtMs(stats.latencyP50), color: "var(--bar-2)" });
      max = Math.max(max, stats.latencyP50);
    }
    if (stats.latencyP95 !== null) {
      bars.push({ label: `${source.title} · p95`, value: stats.latencyP95, text: fmtMs(stats.latencyP95), color: "var(--bar-4)" });
      max = Math.max(max, stats.latencyP95);
    }
  }
  if (!bars.length) return `<p>API latency is absent. Review latency is N/A. The chart does not draw N/A as zero.</p>`;
  return hBars(`${slice.key}-latency`, "API latency", "Milliseconds for case calls on this set. Review sources are not on this chart. The smoke call is not in p50 or p95.", bars, max || 1);
}

function agreementChart(slice: SliceModel, sources: readonly Source[]): string {
  const bars: Bar[] = slice.pairs
    .filter((pair) => pair.agreement.value !== null)
    .map((pair) => ({
      label: `${sourceById(sources, pair.left).title} · ${sourceById(sources, pair.right).title}`,
      value: pair.agreement.value,
      text: fmtRatio(pair.agreement),
      color: "var(--bar-1)",
    }));
  return hBars(`${slice.key}-agree`, "Pairwise action agreement", "Each bar is one pair on the cases both sources decided. The axis is a rate from 0 to 1. A pair with no common cases is not a zero bar.", bars, 1);
}

function scoreRow(rank: string, title: string, score: Score, absent: string): string {
  const cells = [
    rank,
    esc(title),
    String(score.cases),
    absent,
    String(score.errors),
    String(score.pass),
    String(score.reject),
    String(score.escalate),
    fmtRatio(score.falseNegativeRate),
    fmtRatio(score.gateRecall),
    fmtRatio(score.directPass),
    fmtRatio(score.passPrecision),
    fmtRatio(score.rejectPrecision),
    fmtRatio(score.coverage),
    fmtRatio(score.directAccuracy),
    fmtRatio(score.escalation),
    fmtRatio(score.selectiveAccuracy),
  ];
  return `<tr>${cells.map((cell, index) => (index === 1 ? `<th scope="row">${cell}</th>` : `<td class="num">${cell}</td>`)).join("")}</tr>`;
}

const SCORE_HEAD = ["Rank", "Source", "Rows", "Absent", "Errors", "Pass", "Reject", "Escalate", "False negatives", "Gate recall", "Direct pass", "Pass precision", "Reject precision", "Coverage", "Direct accuracy", "Escalation", "Selective accuracy"]
  .map((name, index) => `<th scope="col"${index === 1 ? "" : ` class="num"`}>${name}</th>`)
  .join("");

function sameTable(slice: SliceModel, sources: readonly Source[]): string {
  const order = orderByRecall(slice.poolIds.map((id) => ({ id, recall: slice.same[id]?.gateRecall.value ?? null })));
  const body = order
    .map((row) => {
      const score = slice.same[row.id];
      if (!score) return "";
      return scoreRow(row.rank === null ? "N/A" : String(row.rank), sourceById(sources, row.id).title, score, "0");
    })
    .join("");
  return `<div class="scroll"><table><caption>Common cases. Rank is gate recall. A null rate is N/A and has no rank. n = ${slice.commonIds.length}.</caption><thead><tr>${SCORE_HEAD}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function ownTable(slice: SliceModel, sources: readonly Source[]): string {
  const body = sources
    .filter((source) => slice.own[source.id])
    .map((source) => scoreRow("—", source.title, slice.own[source.id], String(slice.ownAbsent[source.id] ?? 0)))
    .join("");
  return `<div class="scroll"><table><caption>Each source on the rows it answered. This table is not a rank. Absent rows are not scores of zero.</caption><thead><tr>${SCORE_HEAD}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function measuredBlock(slice: SliceModel, source: Source): string {
  const stats = slice.api[source.id];
  if (!stats) return `<h3>${esc(source.title)}</h3><p>Tokens, cost, and latency are N/A. The review file has no usage fields.</p>`;
  const smoke = source.smoke;
  const smokeText = smoke
    ? `Smoke call latency ${fmtMs(smoke.latencyMs)}. Input tokens ${smoke.inputTokens ?? "N/A"}. Output tokens ${smoke.outputTokens ?? "N/A"}. Cost USD ${smoke.costUsd ?? "N/A"}. The smoke call is not in the case rates.`
    : "Smoke call absent.";
  return `<h3>${esc(source.title)} measured calls</h3><dl class="stats">
    <dt>Latency p50</dt><dd>${fmtMs(stats.latencyP50)}</dd>
    <dt>Latency p95</dt><dd>${fmtMs(stats.latencyP95)}</dd>
    <dt>Latency calls</dt><dd>${stats.latencyN ? String(stats.latencyN) : "N/A"}</dd>
    <dt>Input tokens</dt><dd>${fmtKnown(stats.input)}</dd>
    <dt>Output tokens</dt><dd>${fmtKnown(stats.output)}</dd>
    <dt>Cached tokens</dt><dd>${fmtKnown(stats.cached)}</dd>
    <dt>Reasoning tokens</dt><dd>${fmtKnown(stats.reasoning)}</dd>
    <dt>Cost USD</dt><dd>${fmtMoney(stats.cost)}</dd>
    <dt>Retries</dt><dd>${stats.retries.known === 0 ? "N/A" : `${stats.retries.sum} on ${stats.retries.known} calls`}</dd>
    <dt>Problem rows</dt><dd>${stats.problems} of ${stats.answered}</dd>
    <dt>HTTP status</dt><dd>${esc(stats.http)}</dd>
    <dt>Estimate decision tokens</dt><dd>${fmtKnown(stats.estimateDecision)}</dd>
    <dt>Estimate baseline tokens on avoided calls</dt><dd>${fmtKnown(stats.estimateBaselineAvoided)}</dd>
    <dt>Avoided calls</dt><dd>${stats.avoidedCalls}</dd>
    <dt>Snapshots on this set</dt><dd>${stats.snapshots.length ? esc(stats.snapshots.join(", ")) : "absent"}</dd>
  </dl><p>${esc(smokeText)}</p>`;
}

function pairsBlock(slice: SliceModel, sources: readonly Source[]): string {
  const rows = slice.pairs
    .map((pair) => {
      const left = sourceById(sources, pair.left).title;
      const right = sourceById(sources, pair.right).title;
      return `<tr><th scope="row">${esc(left)} · ${esc(right)}</th><td>${fmtRatio(pair.agreement)}</td><td class="num">${pair.agreement.den}</td></tr>`;
    })
    .join("");
  const lists = slice.pairs
    .map((pair) => {
      const left = sourceById(sources, pair.left).title;
      const right = sourceById(sources, pair.right).title;
      if (!pair.disagreements.length) return "";
      const items = pair.disagreements
        .map((item) => `<li><a href="#case-${esc(item.id)}">${esc(item.id)}</a> ${esc(left)} ${item.left} · ${esc(right)} ${item.right}</li>`)
        .join("");
      return `<details open><summary>${esc(left)} and ${esc(right)}: ${pair.disagreements.length} disagreements</summary><ul>${items}</ul></details>`;
    })
    .join("");
  return `${agreementChart(slice, sources)}<div class="scroll"><table><caption>Pairwise agreement. Each pair has its own case count.</caption><thead><tr><th scope="col">Pair</th><th scope="col">Agreement</th><th scope="col" class="num">Cases</th></tr></thead><tbody>${rows}</tbody></table></div>${lists}`;
}

function panel(slice: SliceModel, sources: readonly Source[]): string {
  const hidden = slice.key === "heldout" ? "" : " hidden";
  const note = `Common cases: ${slice.commonIds.length} of ${slice.size}. Rank sources: ${slice.poolIds.map((id) => sourceById(sources, id).title).join(", ") || "none"}. ${slice.partialIds.length ? `Not in the rank: ${slice.partialIds.map((id) => sourceById(sources, id).title).join(", ")}.` : "No partial source is outside the rank."} Pending sources are not on the chart.`;
  const stacks = stackChart(
    `${slice.key}-counts`,
    slice.poolIds
      .map((id) => {
        const score = slice.same[id];
        return score ? { label: sourceById(sources, id).title, pass: score.pass, reject: score.reject, escalate: score.escalate } : null;
      })
      .filter((row): row is { label: string; pass: number; reject: number; escalate: number } => Boolean(row)),
  );
  const matrices = slice.poolIds
    .map((id) => {
      const score = slice.same[id];
      if (!score) return "";
      return `<div class="card"><h3>${esc(sourceById(sources, id).title)}</h3>${gateTable(score)}<p>False negatives ${fmtRatio(score.falseNegativeRate)}. Gate recall ${fmtRatio(score.gateRecall)}. Pass precision ${fmtRatio(score.passPrecision)}. Reject precision ${fmtRatio(score.rejectPrecision)}.</p></div>`;
    })
    .join("");
  const labelCards = sources
    .map((source) => {
      const block = slice.labels[source.id];
      if (source.kind === "api") return `<div class="card"><h3>${esc(source.title)}</h3><p>This API does not emit a label. The gate table is the confusion record.</p></div>`;
      if (!block) return "";
      return `<div class="card"><h3>${esc(source.title)} label</h3>${labelTable(block)}</div>`;
    })
    .join("");
  const measured = sources.map((source) => measuredBlock(slice, source)).join("");
  return `<section class="panel" data-panel="${slice.key}"${hidden}>
    <h2>${esc(slice.label)}</h2>
    <p>${esc(note)}</p>
    <h3>Action counts</h3>
    <ul class="legend"><li><i style="background:var(--bar-1)" aria-hidden="true"></i>Pass</li><li><i style="background:var(--bar-3)" aria-hidden="true"></i>Reject</li><li><i style="background:var(--bar-2)" aria-hidden="true"></i>Escalate</li></ul>
    ${stacks}
    <h3>Rates</h3>
    <ul class="legend"><li><i style="background:var(--bar-1)" aria-hidden="true"></i>Gate recall</li><li><i style="background:var(--bar-2)" aria-hidden="true"></i>Direct accuracy</li><li><i style="background:var(--bar-3)" aria-hidden="true"></i>Coverage</li><li><i style="background:var(--bar-4)" aria-hidden="true"></i>Escalation</li></ul>
    ${rateChart(slice, sources)}
    ${sameTable(slice, sources)}
    <h3>Own rows</h3>
    ${ownTable(slice, sources)}
    <h3>Gate confusion</h3>
    <div class="grid">${matrices}</div>
    <h3>Label confusion</h3>
    <div class="grid">${labelCards}</div>
    <h3>Pairwise agreement</h3>
    ${pairsBlock(slice, sources)}
    <h3>Measured API use</h3>
    <p>A problem row has no gate, error text, or an HTTP status other than 200. Review latency is N/A. Do not read N/A as zero.</p>
    ${latencyChart(slice, sources)}
    ${measured}
  </section>`;
}

function probTable(title: string, probabilities: Record<string, ProbItem> | null, parts: Record<string, number> | null, score: number | null): string {
  if (!probabilities) return "";
  const rows = Object.entries(probabilities)
    .map(([name, item]) => {
      const value = item.type === "score" ? fmtNum(item.score) : item.type === "noul" ? fmtNum(item.noul) : esc(item.choice ?? "N/A");
      const probs = item.probabilities
        ? Object.entries(item.probabilities)
            .map(([key, n]) => `<span title="${esc(String(n))}">${esc(key)} ${n.toFixed(3)}</span>`)
            .join(" ")
        : "N/A";
      return `<tr><th scope="row">${esc(name)}</th><td>${value}</td><td>${item.confidence === undefined ? "N/A" : fmtNum(item.confidence)}</td><td>${probs}</td></tr>`;
    })
    .join("");
  const partText = parts ? Object.entries(parts).map(([key, n]) => `${key} ${n.toFixed(3)}`).join(" · ") : "absent";
  return `<h4>${esc(title)} probabilities</h4><p>Stored score ${score === null ? "N/A" : String(score)}. Parts: ${esc(partText)}.</p><div class="scroll"><table><caption>${esc(title)} question probabilities</caption><thead><tr><th scope="col">Question</th><th scope="col">Value</th><th scope="col">Confidence</th><th scope="col">Probabilities</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function fmtNum(value: number | undefined): string {
  return typeof value === "number" ? value.toFixed(3) : "N/A";
}

function profileHtml(fixture: Fixture): string {
  const languages = fixture.candidate.languages.map((item) => `${item.name} ${item.level}`).join(", ");
  const facts = fixture.candidate.facts.map((fact) => `<li>${esc(fact)}</li>`).join("");
  return `<section><h3>Profile</h3><dl>
    <dt>Country</dt><dd>${esc(fixture.candidate.country)}</dd>
    <dt>City</dt><dd>${esc(fixture.candidate.city)}</dd>
    <dt>Headline</dt><dd>${esc(fixture.candidate.headline)}</dd>
    <dt>Role</dt><dd>${esc(fixture.candidate.role)}</dd>
    <dt>Start</dt><dd>${esc(fixture.candidate.start)}</dd>
    <dt>Skills</dt><dd>${esc(fixture.candidate.skills.join(", "))}</dd>
    <dt>Languages</dt><dd>${esc(languages)}</dd>
    <dt>Work</dt><dd>${esc(fixture.candidate.bullets)}</dd>
  </dl><h4>Facts</h4><ul>${facts}</ul></section>`;
}

function postingHtml(fixture: Fixture): string {
  const salary = fixture.posting.salary ? `<dt>Salary</dt><dd>${esc(fixture.posting.salary)}</dd>` : "";
  return `<section><h3>Posting</h3><dl>
    <dt>Title</dt><dd>${esc(fixture.posting.title)}</dd>
    <dt>Company</dt><dd>${esc(fixture.posting.company)}</dd>
    <dt>Place</dt><dd>${esc(fixture.posting.place)}</dd>
    <dt>Remote</dt><dd>${fixture.posting.remote ? "yes" : "no"}</dd>
    ${salary}
  </dl><p class="post">${esc(fixture.posting.description)}</p></section>`;
}

function caseHtml(row: ReportModel["cases"][number], sources: readonly Source[], fixtures: Map<string, Fixture>): string {
  const fixture = fixtures.get(row.id);
  if (!fixture) return "";
  const actions: string[] = [];
  const decisionRows = sources
    .map((source) => {
      if (source.status === "pending") return `<tr><th scope="row">${esc(source.title)}</th><td>Pending</td><td>N/A</td><td>N/A</td><td>N/A</td></tr>`;
      const call = row.decisions[source.id];
      if (!call) return `<tr><th scope="row">${esc(source.title)}</th><td>Absent</td><td>N/A</td><td>N/A</td><td>N/A</td></tr>`;
      if (call.action) actions.push(call.action);
      const reason = source.kind === "review" ? esc(call.reason ?? "No reason text") : "No reason text";
      const label = source.kind === "review" ? esc(call.reviewerLabel ?? "No label") : "No label";
      const latency = source.kind === "api" ? fmtMs(call.latencyMs) : "N/A";
      const error = call.error ? ` Error: ${esc(call.error)}.` : "";
      return `<tr><th scope="row">${esc(source.title)}</th><td>${call.action ?? "No action"}${error}</td><td>${label}</td><td>${reason}</td><td>${latency}</td></tr>`;
    })
    .join("");
  const differ = new Set(actions).size > 1;
  const probs = sources
    .map((source) => {
      const call = row.decisions[source.id];
      if (!call?.probabilities) return "";
      return probTable(source.title, call.probabilities, call.parts, call.productionScore);
    })
    .join("");
  const tags = row.tags.join(", ");
  return `<details class="case" id="case-${esc(row.id)}" data-split="${row.split}" data-clear="${row.clear ? "1" : "0"}" data-gold="${row.gold}" data-actions="${esc(actions.join(","))}">
    <summary><span class="id">${esc(row.id)}</span> ${row.gold} · ${row.split} · ${esc(tags)}${differ ? " · Actions differ" : ""}</summary>
    <div class="pair">${profileHtml(fixture)}${postingHtml(fixture)}</div>
    <h3>Decisions</h3>
    <div class="scroll"><table><caption>Actions for ${esc(row.id)}. Gold is ${row.gold}.</caption><thead><tr><th scope="col">Source</th><th scope="col">Action</th><th scope="col">Reviewer label</th><th scope="col">Reason</th><th scope="col">Latency</th></tr></thead><tbody>${decisionRows}</tbody></table></div>
    ${probs || "<p>No API probabilities on this case.</p>"}
  </details>`;
}

function savingsData(model: ReportModel): Record<string, Record<string, { avoidedCalls: number; input: Sum; output: Sum; estimateBaselineTokensOnAvoided: number | null }>> {
  const out: Record<string, Record<string, { avoidedCalls: number; input: Sum; output: Sum; estimateBaselineTokensOnAvoided: number | null }>> = {};
  for (const source of model.sources) {
    if (source.kind !== "api" || source.status === "pending") continue;
    out[source.id] = {};
    for (const slice of model.slices) {
      const stats = slice.api[source.id];
      if (!stats) continue;
      out[source.id][slice.key] = {
        avoidedCalls: stats.avoidedCalls,
        input: stats.input,
        output: stats.output,
        estimateBaselineTokensOnAvoided: measured(stats.estimateBaselineAvoided),
      };
    }
  }
  return out;
}

const CLIENT_JS = `(function () {
  var data = JSON.parse(document.getElementById("view-data").textContent);
  var buttons = document.querySelectorAll("[data-set]");
  var panels = document.querySelectorAll("[data-panel]");
  var cases = document.querySelectorAll("details.case");
  var search = document.getElementById("q");
  var gold = document.getElementById("gold");
  var disagree = document.getElementById("disagree");
  var priceIn = document.getElementById("price-in");
  var priceOut = document.getElementById("price-out");
  var baseTokens = document.getElementById("base-tokens");
  var sourcePick = document.getElementById("save-source");
  var scenario = document.getElementById("scenario");
  var hint = document.getElementById("estimate-hint");
  var theme = document.getElementById("theme");
  var form = document.getElementById("scenario-form");
  var setName = "heldout";

  function readNum(input) {
    if (!input || input.value.trim() === "") return null;
    var n = Number(input.value);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }

  function money(n) {
    return "$" + n.toFixed(6);
  }

  function renderScenario() {
    if (!scenario) return;
    var source = sourcePick ? sourcePick.value : "";
    var block = data.savings && data.savings[source] && data.savings[source][setName];
    var label = (data.sliceLabels && data.sliceLabels[setName]) || setName;
    if (!block) {
      scenario.textContent = "No API usage file. The calculator has no measured tokens.";
      if (hint) hint.textContent = "";
      return;
    }
    if (hint) {
      if (block.estimateBaselineTokensOnAvoided === null) hint.textContent = "This file has no baseline token estimate for the avoided calls.";
      else hint.textContent = "File estimate of baseline tokens on avoided calls in this set: " + block.estimateBaselineTokensOnAvoided + ". This number is an estimate. It is not in the fields.";
    }
    var pin = readNum(priceIn);
    var pout = readNum(priceOut);
    var base = readNum(baseTokens);
    var lines = [];
    lines.push("Case set: " + label + ".");
    lines.push("Avoided calls on this set: " + block.avoidedCalls + ". This count is pass plus reject. It is not a token count.");
    var decision = null;
    if (block.input.known === 0 || block.output.known === 0) lines.push("Measured input or output tokens are absent. The decision scenario is N/A.");
    else if (pin === null || pout === null) lines.push("Type an input price and an output price. The page does not assume a price.");
    else {
      decision = (block.input.sum / 1000000) * pin + (block.output.sum / 1000000) * pout;
      lines.push("Scenario decision USD: " + money(decision) + ". Input tokens " + block.input.sum + ". Output tokens " + block.output.sum + ".");
    }
    if (base === null || pin === null) lines.push("Type a baseline token count and an input price for the avoided-call scenario.");
    else {
      var avoided = (block.avoidedCalls * base / 1000000) * pin;
      lines.push("Scenario avoided USD: " + money(avoided) + ". Baseline tokens per call " + base + ".");
      if (decision !== null) lines.push("Scenario difference (avoided minus decision): " + money(avoided - decision) + ". This difference is not measured savings.");
    }
    lines.push("Measured USD stays in the measured table. This box does not add to it.");
    scenario.textContent = lines.join(" ");
  }

  function apply() {
    for (var i = 0; i < buttons.length; i++) buttons[i].setAttribute("aria-pressed", buttons[i].getAttribute("data-set") === setName ? "true" : "false");
    for (var j = 0; j < panels.length; j++) panels[j].hidden = panels[j].getAttribute("data-panel") !== setName;
    var q = search && search.value ? search.value.trim().toLowerCase() : "";
    var g = gold ? gold.value : "";
    var wantDisagree = !!(disagree && disagree.checked);
    for (var k = 0; k < cases.length; k++) {
      var item = cases[k];
      var splitOk = setName === "all" || (setName === "clear" ? item.getAttribute("data-clear") === "1" : setName === "heldout-clear" ? item.getAttribute("data-split") === "heldout" && item.getAttribute("data-clear") === "1" : item.getAttribute("data-split") === setName);
      var goldOk = !g || item.getAttribute("data-gold") === g;
      var textOk = !q || item.textContent.toLowerCase().indexOf(q) !== -1;
      var disagreeOk = true;
      if (wantDisagree) {
        var actions = (item.getAttribute("data-actions") || "").split(",").filter(Boolean);
        var uniq = {};
        for (var a = 0; a < actions.length; a++) uniq[actions[a]] = true;
        disagreeOk = Object.keys(uniq).length > 1;
      }
      item.hidden = !(splitOk && goldOk && textOk && disagreeOk);
    }
    renderScenario();
  }

  for (var b = 0; b < buttons.length; b++) {
    buttons[b].addEventListener("click", function (event) {
      setName = event.currentTarget.getAttribute("data-set");
      apply();
    });
  }
  if (search) search.addEventListener("input", apply);
  if (gold) gold.addEventListener("change", apply);
  if (disagree) disagree.addEventListener("change", apply);
  if (priceIn) priceIn.addEventListener("input", renderScenario);
  if (priceOut) priceOut.addEventListener("input", renderScenario);
  if (baseTokens) baseTokens.addEventListener("input", renderScenario);
  if (sourcePick) sourcePick.addEventListener("change", renderScenario);
  if (form) form.addEventListener("submit", function (event) { event.preventDefault(); });
  if (theme) theme.addEventListener("click", function () {
    var root = document.documentElement;
    var current = root.getAttribute("data-theme");
    var next = current === "dark" ? "light" : current === "light" ? "" : "dark";
    if (next) root.setAttribute("data-theme", next);
    else root.removeAttribute("data-theme");
    theme.textContent = next ? "Theme: " + next : "Theme: system";
  });
  apply();
})();`;

function render(model: ReportModel, sources: readonly Source[], fixtures: Map<string, Fixture>): string {
  const buttons = model.slices
    .map((slice) => `<button type="button" data-set="${slice.key}" aria-pressed="${slice.key === "heldout" ? "true" : "false"}">${esc(slice.label)}</button>`)
    .join("");
  const sourceRows = model.sources
    .map((source) => {
      const file = source.file ? `<a href="${esc(source.file)}">${esc(source.file)}</a>` : "absent";
      const status = source.status === "pending" ? "Pending" : source.status === "ready" ? "Ready" : source.status === "partial" ? "Partial" : "No rows";
      return `<tr><th scope="row">${esc(source.title)}</th><td>${status}</td><td>${file}</td><td>${esc(source.requestedModel ?? "absent")}</td><td>${esc(source.actualModel)}</td><td>${source.snapshots.length ? esc(source.snapshots.join(", ")) : "absent"}</td><td>${esc(source.pass ?? "Not a review")}</td><td>${esc(source.completedAt ?? "absent")}</td><td>${esc(source.stopFlag)}</td><td class="num">${source.status === "pending" ? "N/A" : String(source.rows)}</td></tr>`;
    })
    .join("");
  const issueBlock = model.issues.length ? `<ul>${model.issues.map((issue) => `<li>${esc(issue)}</li>`).join("")}</ul>` : "<p>No validation issues.</p>";
  const apiOptions = model.sources
    .filter((source) => source.kind === "api" && source.status !== "pending")
    .map((source) => `<option value="${esc(source.id)}">${esc(source.title)}</option>`)
    .join("");
  const view = {
    sliceLabels: Object.fromEntries(model.slices.map((slice) => [slice.key, slice.label])),
    savings: savingsData(model),
  };
  const viewJson = JSON.stringify(view).replace(/</g, "\\u003c");
  const links = [
    ["comparison.json", "comparison.json"],
    ["../fixtures/cases.ts", "fixtures/cases.ts"],
    ["../review/neutral-id-map.json", "neutral-id-map.json"],
    ...model.sources.filter((source) => source.file).map((source) => [source.file as string, source.title]),
  ]
    .map(([href, label]) => `<li><a href="${esc(href)}">${esc(label)}</a></li>`)
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Decision comparison</title>
<style>
:root {
  color-scheme: light;
  --report-bg: #f4f6f3;
  --report-fg: #162018;
  --report-muted: #4a574e;
  --report-card: #ffffff;
  --report-line: #d5dfd7;
  --report-accent: #0c6b4d;
  --report-focus: #0c6b4d;
  --report-warn: #8a4b08;
  --bar-1: #0c6b4d;
  --bar-2: #1d4e89;
  --bar-3: #8a4b08;
  --bar-4: #5c3d7a;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --report-bg: #121613;
    --report-fg: #e7eee8;
    --report-muted: #b7c4ba;
    --report-card: #1c221e;
    --report-line: #314038;
    --report-accent: #8ddec0;
    --report-focus: #8ddec0;
    --report-warn: #f0c08a;
    --bar-1: #3dbe90;
    --bar-2: #8eb6ef;
    --bar-3: #f0c08a;
    --bar-4: #d2b6f0;
  }
}
:root[data-theme="light"] {
  color-scheme: light;
  --report-bg: #f4f6f3;
  --report-fg: #162018;
  --report-muted: #4a574e;
  --report-card: #ffffff;
  --report-line: #d5dfd7;
  --report-accent: #0c6b4d;
  --report-focus: #0c6b4d;
  --report-warn: #8a4b08;
  --bar-1: #0c6b4d;
  --bar-2: #1d4e89;
  --bar-3: #8a4b08;
  --bar-4: #5c3d7a;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --report-bg: #121613;
  --report-fg: #e7eee8;
  --report-muted: #b7c4ba;
  --report-card: #1c221e;
  --report-line: #314038;
  --report-accent: #8ddec0;
  --report-focus: #8ddec0;
  --report-warn: #f0c08a;
  --bar-1: #3dbe90;
  --bar-2: #8eb6ef;
  --bar-3: #f0c08a;
  --bar-4: #d2b6f0;
}
html, body { background: transparent; color: var(--report-fg); margin: 0; }
body { font: 16px/1.45 ui-sans-serif, system-ui, sans-serif; }
.wrap { background: var(--report-bg);  }
.wrap > * { max-width: 1100px; margin: 0 auto; padding: 0 20px; }
header, footer, nav, section { padding-top: 8px; padding-bottom: 8px; }
h1 { font-size: 1.8rem; line-height: 1.2; margin: 20px 0 8px; }
h2 { font-size: 1.3rem; margin: 28px 0 8px; }
h3 { font-size: 1.05rem; margin: 18px 0 8px; }
h4 { font-size: 1rem; margin: 12px 0 6px; }
p, li, dd { color: var(--report-fg); }
.muted, figcaption, caption { color: var(--report-muted); }
a { color: var(--report-accent); }
.skip { position: absolute; left: 8px; top: -40px; background: var(--report-card); padding: 8px; }
.skip:focus { top: 8px; }
button, input, select { font: inherit; color: inherit; background: var(--report-card); border: 1px solid var(--report-line); border-radius: 6px; padding: 6px 10px; }
button { cursor: pointer; }
button[aria-pressed="true"] { border-color: var(--report-accent); outline: 2px solid var(--report-accent); }
:focus-visible { outline: 2px solid var(--report-focus); outline-offset: 2px; }
.sets, .filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
.card, details.case, form, .note { background: var(--report-card); border: 1px solid var(--report-line); border-radius: 10px; padding: 12px; margin: 12px 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
table { border-collapse: collapse; width: 100%; background: var(--report-card); }
th, td { border-bottom: 1px solid var(--report-line); padding: 6px 8px; vertical-align: top; text-align: left; }
.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
caption { text-align: left; font-weight: 600; padding: 6px 0; }
.scroll { overflow-x: auto; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; padding: 0; list-style: none; }
.legend i { display: inline-block; width: 12px; height: 12px; margin-right: 6px; }
dl.stats { display: grid; grid-template-columns: minmax(12rem, 18rem) 1fr; gap: 4px 12px; }
dt { color: var(--report-muted); }
dd { margin: 0; }
.post { white-space: pre-wrap; }
.id { font-variant-numeric: tabular-nums; font-weight: 700; }
.chart { margin: 8px 0 16px; }
.badge { color: var(--report-warn); font-weight: 700; }
footer ul { padding-left: 18px; }
@media (max-width: 720px) {
  .wrap > * { padding-left: 12px; padding-right: 12px; }
  dl.stats { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<a class="skip" href="#report">Skip to report</a>
<div class="wrap" id="report">
<header>
  <h1>Decision comparison</h1>
  <p>Perplexity free, Parallel decisions-fast free, Jev 1.14, Sonnet 5.5, Haiku 5.5, and Luna.</p>
  <p class="muted">Generated ${esc(model.generatedAt)}. Gold cases ${model.corpus.cases}. Eligible ${model.corpus.byLabel.eligible}. Ineligible ${model.corpus.byLabel.ineligible}. Ambiguous ${model.corpus.byLabel.ambiguous}. Held-out ${model.corpus.heldout}. Dev ${model.corpus.dev}. Clear ${model.corpus.clear}.</p>
  <button type="button" id="theme">Theme: system</button>
</header>
<section>
  <h2>Sources</h2>
  <p>Pending means the result file is absent. Pending is not a score of zero. Haiku 5.5 is a repaired second pass. The other reviews are a first pass.</p>
  <div class="scroll"><table><caption>Source status. Rows come from the result files, not from a summary.</caption><thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">File</th><th scope="col">Requested model</th><th scope="col">Actual model</th><th scope="col">Snapshot</th><th scope="col">Review pass</th><th scope="col">Completed</th><th scope="col">Stop flag</th><th scope="col">Rows</th></tr></thead><tbody>${sourceRows}</tbody></table></div>
  <h3>Validation</h3>
  ${issueBlock}
  <p>Excluded review files: ${esc(model.excludedReviews.join(", ") || "none")}.</p>
</section>
<section>
  <h2>Definitions</h2>
  ${METHOD.map((line) => `<p>${esc(line)}</p>`).join("")}
</section>
<nav class="sets" aria-label="Case set">
  ${buttons}
</nav>
<section>
  <h2>Scenario calculator</h2>
  <p>The fields are scenario inputs. They are not measured prices. A blank field stays blank.</p>
  <form id="scenario-form" autocomplete="off">
    <div class="filters">
      <label for="save-source">API<select id="save-source">${apiOptions || "<option value=\"\">No API file</option>"}</select></label>
      <label for="price-in">Input price, USD per 1,000,000 tokens<input id="price-in" type="number" min="0" step="0.01" autocomplete="off" inputmode="decimal"></label>
      <label for="price-out">Output price, USD per 1,000,000 tokens<input id="price-out" type="number" min="0" step="0.01" autocomplete="off" inputmode="decimal"></label>
      <label for="base-tokens">Baseline input tokens for one expensive call<input id="base-tokens" type="number" min="0" step="1" autocomplete="off" inputmode="numeric"></label>
    </div>
  </form>
  <p id="estimate-hint"></p>
  <p id="scenario" aria-live="polite">Type an input price, an output price, and a baseline token count.</p>
</section>
${model.slices.map((slice) => panel(slice, sources)).join("")}
<section id="cases">
  <h2>Cases</h2>
  <p>The set buttons also filter this list. Gold, text, and the disagreement box filter the list only. They do not change the rate tables.</p>
  <div class="filters">
    <label for="q">Text<input id="q" type="search" autocomplete="off"></label>
    <label for="gold">Gold label<select id="gold"><option value="">Any</option><option>eligible</option><option>ineligible</option><option>ambiguous</option></select></label>
    <label for="disagree"><input id="disagree" type="checkbox"> Show a case only when actions differ</label>
  </div>
  ${model.cases.map((row) => caseHtml(row, sources, fixtures)).join("")}
</section>
<footer>
  <h2>Source files</h2>
  <ul>${links}</ul>
  <p>Regenerate with <code>npx tsx benchmarks/render-comparison.ts</code>. Run it again after a new result file is present.</p>
  <p>Charts use SVG and CSS in this file. The page does not load a network asset.</p>
</footer>
</div>
<noscript><p>Script is off. The page shows the held-out set. Theme follows the system. The scenario box does not run.</p></noscript>
<script type="application/json" id="view-data">${viewJson}</script>
<script>${CLIENT_JS}</script>
</body>
</html>`;
}

function assertHtml(html: string, model: ReportModel) {
  check(html.startsWith("<!DOCTYPE html>"), "doctype");
  check(html.includes("<h1>"), "h1");
  check(html.includes("<svg"), "svg");
  check(html.includes('role="img"'), "chart name");
  check(!/<script\s+src=/.test(html), "external script");
  check(!/<link[^>]+stylesheet/.test(html), "external css");
  check(!/https?:\/\//.test(html), "network url");
  check(!/OPENROUTER|API_KEY|sk-or-|sk-ant-|Bearer |PRIVATE KEY|gen-dec-/.test(html), "secret or response id");
  check(html.includes("background: transparent"), "outer transparent");
  check(html.includes("--report-bg"), "theme vars");
  check(html.includes("Repaired second pass"), "haiku pass");
  check(html.includes("does not use a majority vote as gold"), "no majority");
  check(html.includes("neutral-id-map.json"), "map link");
  for (const pending of model.pending) check(html.includes(pending.title) && html.includes("Pending"), `${pending.title} pending`);
  for (const ready of model.ready) check(html.includes(ready.title), ready.title);
  const jsonIsland = html.match(/<script type="application\/json" id="view-data">([\s\S]*?)<\/script>/);
  check(jsonIsland, "view data");
  JSON.parse(jsonIsland[1]);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  check(scripts.length === 1, "one script");
  new vm.Script(scripts[0][1]);
  check(!html.includes("cdn"), "cdn");
}

function jsonPayload(model: ReportModel) {
  return {
    generator: model.generator,
    generatedAt: model.generatedAt,
    command: model.command,
    corpus: model.corpus,
    pending: model.pending,
    ready: model.ready,
    issues: model.issues,
    excludedReviews: model.excludedReviews,
    definitions: METHOD,
    sources: model.sources,
    slices: model.slices,
    cases: model.cases.map((row) => ({
      id: row.id,
      split: row.split,
      gold: row.gold,
      tags: row.tags,
      clear: row.clear,
      decisions: row.decisions,
    })),
    profileNote: "Profile text is in comparison.html. The source is benchmarks/fixtures/cases.ts.",
  };
}

function writeAggregate(model: ReportModel): { written: boolean; reason: string | null } {
  if (existsSync(JSON_PATH)) {
    try {
      const current: unknown = JSON.parse(readFileSync(JSON_PATH, "utf8"));
      if (!isRecord(current) || current.generator !== GENERATOR) {
        return { written: false, reason: "comparison.json exists and has a different generator" };
      }
    } catch {
      return { written: false, reason: "comparison.json exists and did not parse" };
    }
  }
  writeFileSync(JSON_PATH, `${JSON.stringify(jsonPayload(model), null, 2)}\n`);
  return { written: true, reason: null };
}

function main() {
  selfCheck();
  const { model, sources, fixtures } = build();
  const html = render(model, sources, fixtures);
  assertHtml(html, model);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(HTML_PATH, html);
  const aggregate = writeAggregate(model);
  const payload = {
    command: model.command,
    html: HTML_PATH,
    json: aggregate.written ? JSON_PATH : null,
    jsonNote: aggregate.reason,
    pending: model.pending.map((item) => item.title),
    ready: model.ready,
    check: "ok",
    htmlBytes: statSync(HTML_PATH).size,
  };
  console.log(JSON.stringify(payload, null, 2));
}

main();
