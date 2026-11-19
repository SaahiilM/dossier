import { describe, expect, it } from "vitest";

import { fitAutoDraftBlocked, fitFromAnswers, type PostingFit } from "./fit";
import type { FactorAnswers } from "./scoring/factors";

const fit = (over: Partial<PostingFit> = {}): PostingFit => ({ score: 88, reasons: [], redFlags: [], ...over });

describe("fitAutoDraftBlocked", () => {
  it("blocks auto-draft when structured meta is missing (legacy scores)", () => {
    expect(fitAutoDraftBlocked(fit())).toBe(true);
  });

  it("blocks auto-draft when the score is stale", () => {
    expect(fitAutoDraftBlocked(fit({ meta: { review: "eligible", blockAutoDraft: false }, stale: true }))).toBe(true);
  });

  it("blocks auto-draft for ineligible or needs_review meta", () => {
    expect(fitAutoDraftBlocked(fit({ meta: { review: "ineligible", blockAutoDraft: true } }))).toBe(true);
    expect(fitAutoDraftBlocked(fit({ meta: { review: "needs_review", blockAutoDraft: true } }))).toBe(true);
    expect(fitAutoDraftBlocked(fit({ meta: { review: "eligible", blockAutoDraft: false } }))).toBe(false);
    expect(fitAutoDraftBlocked(fit({ meta: { review: "ineligible", blockAutoDraft: false } }))).toBe(true);
  });
});

const answers = (change: Partial<FactorAnswers> = {}): FactorAnswers => ({
  requirements: [{ text: "Figma", mustHave: true, covered: true, evidence: "Figma" }],
  work: { value: 1, reason: "Relevant work." },
  extra: { value: 1, reason: "Relevant projects." },
  education: { value: 1, reason: "Meets the requirement." },
  seniority: { fit: "fits", reason: "Within the chosen levels." },
  location: { fit: "fits", reason: "Workplace fits." },
  thin: false,
  ...change,
});

describe("fitFromAnswers auto-draft metadata", () => {
  it("marks complete factor answers eligible, and blocks a missing must-have", () => {
    expect(fitFromAnswers(answers()).meta).toEqual({ review: "eligible", blockAutoDraft: false });
    const missing = fitFromAnswers(answers({ requirements: [{ text: "Kubernetes", mustHave: true, covered: false, evidence: null }] }));
    expect(missing.meta).toMatchObject({ review: "ineligible", blockAutoDraft: true, issues: ["missing_required"] });
    expect(fitAutoDraftBlocked(missing)).toBe(true);
  });

  it("marks a workplace stretch as needing review and blocks auto-draft", () => {
    const fit = fitFromAnswers(answers({ location: { fit: "stretch", reason: "Outside the preferred radius." } }));
    expect(fit.meta).toMatchObject({ review: "needs_review", blockAutoDraft: true, issues: ["uncertain"] });
    expect(fitAutoDraftBlocked(fit)).toBe(true);
  });
});
