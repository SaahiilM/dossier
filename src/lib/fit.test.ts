import { describe, expect, it } from "vitest";

import { fitAutoDraftBlocked, type PostingFit } from "./fit";

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
  });
});
