import { describe, expect, it } from "vitest";

import {
  canonicalCaptureUrl,
  captureIngestionState,
  createCaptureInputSchema,
  isLinkedInCaptureUrl,
  normalizeCaptureUrl,
} from "./domain";

const validInput = {
  url: "https://www.linkedin.com/jobs/view/123?trk=public_jobs&utm_source=share#job",
  clientRequestId: "request-1",
};

describe("capture URL and input domain", () => {
  it("canonicalizes tracking variants while leaving the submitted URL available to store verbatim", () => {
    expect(canonicalCaptureUrl("https://www.linkedin.com/jobs/view/123?trk=public_jobs&utm_source=share#job")).toBe(
      canonicalCaptureUrl("http://linkedin.com/jobs/view/123/"),
    );
    expect(validInput.url).toContain("trk=public_jobs");
  });

  it("normalizes an official employer URL and strips only its fragment", () => {
    expect(normalizeCaptureUrl(" https://careers.example/role/123?team=design#apply ")).toBe("https://careers.example/role/123?team=design");
  });

  it("rejects protocols, embedded credentials and oversized fields", () => {
    for (const url of ["ftp://jobs.example/1", "javascript:alert(1)", "https://user:pass@jobs.example/1"]) {
      expect(createCaptureInputSchema.safeParse({ ...validInput, url }).success, url).toBe(false);
    }
    expect(createCaptureInputSchema.safeParse({ ...validInput, canonicalEmployerUrl: "https://www.linkedin.com/jobs/view/123" }).success).toBe(false);
    expect(createCaptureInputSchema.safeParse({ ...validInput, text: "x".repeat(100_001) }).success).toBe(false);
    expect(createCaptureInputSchema.safeParse({ ...validInput, note: "x".repeat(2_001) }).success).toBe(false);
    expect(createCaptureInputSchema.safeParse({ ...validInput, url: `https://jobs.example/${"x".repeat(2048)}` }).success).toBe(false);
    expect(createCaptureInputSchema.safeParse({ ...validInput, clientRequestId: "x".repeat(129) }).success).toBe(false);
  });

  it("marks URL-only LinkedIn shares as needing details and does not inspect the page", () => {
    expect(isLinkedInCaptureUrl(validInput.url)).toBe(true);
    expect(captureIngestionState({ originalUrl: validInput.url, text: "", canonicalEmployerUrl: "" })).toBe("NEEDS_DETAILS");
    expect(captureIngestionState({ originalUrl: validInput.url, text: "Official posting text", canonicalEmployerUrl: "" })).toBe("READY");
    expect(captureIngestionState({ originalUrl: validInput.url, text: "", canonicalEmployerUrl: "https://careers.example/role/123" })).toBe("READY");
    expect(captureIngestionState({ originalUrl: "https://jobs.example/role/123", text: "", canonicalEmployerUrl: "" })).toBe("SAVED");
  });
});
