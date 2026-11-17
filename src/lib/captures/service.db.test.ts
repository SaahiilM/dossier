import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});

import { createCapture, getCapture, listCaptures, markCaptureFailed, updateCapture } from "./service";
import { CaptureConflictError } from "./service";

const prisma = () => db.client!;

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

const createInput = (overrides: Partial<Parameters<typeof createCapture>[0]> = {}) => ({
  url: "https://www.linkedin.com/jobs/view/123?trk=public_jobs&utm_source=share#details",
  clientRequestId: "request-one",
  ...overrides,
});

describe("capture service persistence", () => {
  it("persists a LinkedIn share as Needs details and keeps its original URL", async () => {
    const input = createInput();
    const capture = await createCapture(input);
    expect(capture).toMatchObject({
      originalUrl: input.url,
      dedupeUrl: "linkedin.com/jobs/view/123",
      text: "",
      ingestionState: "NEEDS_DETAILS",
      source: "WEB",
    });
  });

  it("makes clientRequestId retries idempotent without replacing the original payload", async () => {
    const first = await createCapture(createInput());
    const retry = await createCapture(createInput({
      url: "https://jobs.other.example/role/456",
      text: "Do not replace the original capture.",
    }));
    expect(retry.id).toBe(first.id);
    expect(retry.originalUrl).toBe(first.originalUrl);
    expect(retry.text).toBe("");
    expect(await prisma().capture.count()).toBe(1);
  });

  it("collapses simultaneous retries to the same persisted capture", async () => {
    const [first, retry] = await Promise.all([createCapture(createInput()), createCapture(createInput())]);
    expect(first.id).toBe(retry.id);
    expect(await prisma().capture.count()).toBe(1);
  });

  it("deduplicates canonical URL variants, preserves the first URL, and fills empty content", async () => {
    const first = await createCapture(createInput({
      url: "https://careers.example/jobs/role-1/?utm_source=newsletter",
      clientRequestId: "request-two",
    }));
    const duplicate = await createCapture(createInput({
      url: "http://www.careers.example/jobs/role-1/#apply",
      clientRequestId: "request-three",
      text: "Full job posting pasted by the user.",
      note: "Met the team at a conference.",
    }));
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.originalUrl).toBe(first.originalUrl);
    expect(duplicate.text).toBe("Full job posting pasted by the user.");
    expect(duplicate.note).toBe("Met the team at a conference.");
    expect(duplicate.ingestionState).toBe("READY");
    expect(await prisma().capture.count()).toBe(1);
  });

  it("moves missing details to Ready, then back to Needs details when cleared", async () => {
    const capture = await createCapture(createInput());
    const withEmployer = await updateCapture(capture.id, { canonicalEmployerUrl: "https://careers.example/jobs/123" });
    expect(withEmployer.ingestionState).toBe("READY");
    expect(withEmployer.originalUrl).toBe(capture.originalUrl);
    const withText = await updateCapture(capture.id, { text: "The user's pasted posting.", canonicalEmployerUrl: "" });
    expect(withText.ingestionState).toBe("READY");
    const cleared = await updateCapture(capture.id, { text: "", canonicalEmployerUrl: "" });
    expect(cleared.ingestionState).toBe("NEEDS_DETAILS");
    expect(cleared.originalUrl).toBe(capture.originalUrl);
  });

  it("paginates and reads a capture by its ID", async () => {
    const first = await createCapture(createInput({ url: "https://jobs.example/1", clientRequestId: "page-1" }));
    await createCapture(createInput({ url: "https://jobs.example/2", clientRequestId: "page-2" }));
    const page = await listCaptures({ limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe(page.items[0]?.id);
    const next = await listCaptures({ limit: 1, cursor: page.nextCursor! });
    expect(next.items).toHaveLength(1);
    expect(next.items[0]?.id).not.toBe(page.items[0]?.id);
    expect(await getCapture(first.id)).toMatchObject({ id: first.id });
    expect(await getCapture("missing")).toBeNull();
  });

  it("stores a bounded failed-ingestion reason and rejects a canonical URL collision", async () => {
    const first = await createCapture(createInput({ url: "https://careers.example/jobs/1", clientRequestId: "failure-1" }));
    const failed = await markCaptureFailed(first.id, "The public page was unavailable.");
    expect(failed).toMatchObject({ ingestionState: "FAILED", ingestionError: "The public page was unavailable." });
    const second = await createCapture(createInput({ url: "https://careers.example/jobs/2", clientRequestId: "failure-2" }));
    await expect(updateCapture(second.id, { canonicalEmployerUrl: "https://careers.example/jobs/1" })).rejects.toBeInstanceOf(CaptureConflictError);
    await expect(updateCapture("missing", { text: "Posting text" })).rejects.toThrow("That capture is no longer available.");
    await expect(createCapture(createInput({ url: "ftp://careers.example/jobs/1", clientRequestId: "invalid-url" }))).rejects.toThrow();
    await expect(createCapture(createInput({ text: "x".repeat(100_001), clientRequestId: "too-long" }))).rejects.toThrow();
  });
});
