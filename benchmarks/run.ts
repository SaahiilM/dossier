// node --conditions=react-server --import ./benchmarks/preload.mjs --import tsx benchmarks/run.ts --live
// Key file: repo root .env. Variable: OPENROUTER_API_KEY.
// Fallback variable: DOSSIER_OPENROUTER_SCORING_KEY. The value is never printed.
// benchmarks/out/results.json and benchmarks/out/report.md stay as the original Perplexity run.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CASES } from "./fixtures/cases.ts";
import {
  ENV_FILE,
  MODEL_ID,
  MODELS,
  compareRuns,
  loadEnvFile,
  modelOutputName,
  readKey,
  redactText,
  renderComparison,
  renderReport,
  runLive,
  summarize,
  type CompareRun,
  type LiveRunResult,
} from "./harness.ts";

const outDir = new URL("./out/", import.meta.url);
const reviewDir = new URL("./review/", import.meta.url);
const PRESERVE = ["results.json", "report.md"] as const;

function sha256(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function quotaReuseReason(result: Pick<LiveRunResult, "stopped" | "rows" | "smoke">): string | null {
  if (result.rows.length >= CASES.length && result.stopped == null) return null;
  if (result.stopped === "rate-limited" || result.stopped === "payment") return result.stopped;
  const statuses = [result.smoke?.httpStatus, ...result.rows.map((row) => row.httpStatus)];
  if (statuses.includes(429)) return "http-429";
  const text = [result.smoke?.error, ...result.rows.map((row) => row.error)].filter(Boolean).join("\n");
  if (/quota|rate limit|too many requests/i.test(text)) return "quota";
  return null;
}

function reviewAggregate(dir: URL) {
  const path = dir.pathname;
  if (!existsSync(path)) return { available: false, files: [] as { file: string; records: number; used: boolean }[] };
  const names = readdirSync(path).filter((name) => name.endsWith(".json") && name !== "blinded-cases.json").sort();
  const files = names.map((name) => {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(readFileSync(join(path, name), "utf8"));
    } catch {
      return { file: name, records: 0, used: false };
    }
    const records = Array.isArray(parsed) ? parsed.length : 0;
    const used = Array.isArray(parsed) && parsed.every((row) => row && typeof row === "object" && "id" in row && !("label" in row));
    return { file: name, records, used };
  });
  return { available: files.some((file) => file.used), files };
}

async function main() {
  if (!process.execArgv.some((arg) => arg.includes("react-server"))) {
    console.error("Run with: node --conditions=react-server --import ./benchmarks/preload.mjs --import tsx benchmarks/run.ts --live");
    process.exit(1);
  }
  loadEnvFile(ENV_FILE);
  if (!process.argv.includes("--live")) {
    console.error("Pass --live. A dry test is: node --conditions=react-server --import ./benchmarks/preload.mjs --import tsx --test benchmarks/harness.test.ts");
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  const preserved = Object.fromEntries(PRESERVE.map((name) => [name, sha256(new URL(name, outDir).pathname)])) as Record<(typeof PRESERVE)[number], string | null>;
  const sessionStartedAt = new Date().toISOString();
  const secrets = [readKey(process.env)].filter((value): value is string => Boolean(value));
  const runs: CompareRun[] = [];
  const written: string[] = [];

  for (const spec of MODELS) {
    console.log(`model ${spec.id}`);
    const live = await runLive({ model: spec, onCase: (id) => console.log(`case ${spec.id} ${id}`) });
    let result: typeof live | (typeof live & Record<string, unknown>) = live;
    let provenance: CompareRun["provenance"] = {
      source: "live",
      sameSession: true,
      completedAt: live.completedAt,
      note: null,
    };
    if (spec.id === MODEL_ID) {
      const reason = quotaReuseReason(live);
      const originalPath = new URL("results.json", outDir).pathname;
      if (reason && existsSync(originalPath)) {
        const attemptName = `${modelOutputName(spec.id)}.live-attempt.json`;
        const attemptPath = new URL(attemptName, outDir);
        const attemptSummary = summarize(live);
        writeFileSync(attemptPath, `${redactText(JSON.stringify({ ...live, summary: attemptSummary, provenance: { source: "live-attempt", sameSession: false, reason } }, null, 2), secrets).text}\n`);
        written.push(attemptPath.pathname);
        const parsed = JSON.parse(readFileSync(originalPath, "utf8")) as LiveRunResult & { summary?: { heldout?: { recall?: number } } };
        const originalRecall = parsed.summary?.heldout?.recall ?? null;
        const { summary: _summary, ...rest } = parsed;
        const reused: LiveRunResult = {
          ...rest,
          billing: "free",
          budgetCapUsd: null,
          budget: rest.budget ?? { billing: "free", capUsd: null, spentUsd: 0, abort: null, exceededAfter: null },
        };
        result = reused;
        provenance = {
          source: "reused",
          sameSession: false,
          completedAt: typeof rest.completedAt === "string" ? rest.completedAt : null,
          note: `Live re-run stopped (${reason}) at ${sessionStartedAt}. This output reuses benchmarks/out/results.json completed at ${typeof rest.completedAt === "string" ? rest.completedAt : "unknown"}. Original heldout recall ${originalRecall ?? "none"}.`,
        };
        console.log(`reuse ${reason} ${provenance.completedAt ?? "unknown"}`);
      }
    }
    const liveResult: LiveRunResult = result;
    const summary = summarize(liveResult);
    const payload = { ...liveResult, summary, provenance };
    const stem = modelOutputName(spec.id);
    const resultsPath = new URL(`${stem}.json`, outDir);
    const reportPath = new URL(`${stem}.md`, outDir);
    writeFileSync(resultsPath, `${redactText(JSON.stringify(payload, null, 2), secrets).text}\n`);
    writeFileSync(reportPath, redactText(renderReport(liveResult, summary), secrets).text);
    written.push(resultsPath.pathname, reportPath.pathname);
    runs.push({
      modelRequested: liveResult.modelRequested,
      rows: liveResult.rows,
      smoke: liveResult.smoke,
      provenance,
    });
    console.log(`stopped ${liveResult.stopped ?? "no"}`);
    console.log(`rows ${liveResult.rows.length}`);
    console.log(`spent ${liveResult.budget?.spentUsd ?? "none"}`);
    console.log(`measuredUsd ${summary.money.measuredUsd.sum} missing ${summary.money.measuredUsd.missing}`);
    console.log(`http429 ${summary.transport.http429 ?? "none"}`);
    console.log(`file ${resultsPath.pathname}`);
  }

  const comparison = {
    node: process.version,
    sessionStartedAt,
    sameSession: runs.every((run) => run.provenance?.sameSession === true),
    preserved,
    reviews: reviewAggregate(reviewDir),
    ...compareRuns(runs),
  };
  const comparisonJson = new URL("comparison.json", outDir);
  const comparisonMd = new URL("comparison.md", outDir);
  writeFileSync(comparisonJson, `${redactText(JSON.stringify(comparison, null, 2), secrets).text}\n`);
  writeFileSync(comparisonMd, redactText(renderComparison(comparison), secrets).text);
  written.push(comparisonJson.pathname, comparisonMd.pathname);
  const after = Object.fromEntries(PRESERVE.map((name) => [name, sha256(new URL(name, outDir).pathname)])) as Record<(typeof PRESERVE)[number], string | null>;
  console.log(`fairSame42 ${comparison.fairSame42}`);
  console.log(`sameSession ${comparison.sameSession}`);
  console.log(`reviews ${comparison.reviews.available ? "yes" : "no"}`);
  console.log(`preserved ${PRESERVE.every((name) => preserved[name] === after[name]) ? "yes" : "no"}`);
  console.log(`comparison ${comparisonJson.pathname}`);
  if (PRESERVE.some((name) => preserved[name] !== after[name])) process.exit(1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "error";
  console.error(redactText(message, [readKey(process.env) ?? ""].filter((value) => value.length >= 8)).text.slice(0, 200));
  process.exit(1);
});
