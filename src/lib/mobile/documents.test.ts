import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  application: null as unknown,
  findFirst: vi.fn(),
  loadDocuments: vi.fn(),
  loadProfileName: vi.fn(),
  loadSettings: vi.fn(),
  renderPdf: vi.fn(),
}));

vi.mock("@/lib/application-documents", () => ({ loadDocuments: (...args: unknown[]) => state.loadDocuments(...args) }));
vi.mock("@/lib/pdf/render", () => ({ renderPdf: (...args: unknown[]) => state.renderPdf(...args) }));
vi.mock("@/lib/prisma", () => ({ prisma: { application: { findFirst: (...args: unknown[]) => state.findFirst(...args) } } }));
vi.mock("@/lib/profile-data", () => ({ loadProfileName: (...args: unknown[]) => state.loadProfileName(...args) }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: (...args: unknown[]) => state.loadSettings(...args) }));

import { DocumentKind } from "@/generated/prisma/enums";
import { getMobileApplicationDocument, getMobileApplicationDocuments, exportMobileApplicationDocumentPdf } from "./documents";

const resumeUnits = [{ id: "summary", label: "Summary", text: "Product designer with ten years of experience." }];
const letterUnits = [{ id: "paragraph:1", label: "Opening", text: "I am interested in the role." }];
const createdAt = new Date("2026-11-18T12:00:00.000Z");

function application(documents = [
  { id: "resume-doc", kind: DocumentKind.RESUME, units: resumeUnits, updatedAt: createdAt, versions: [{ id: "resume-version", units: resumeUnits }] },
  { id: "letter-doc", kind: DocumentKind.COVER_LETTER, units: letterUnits, updatedAt: createdAt, versions: [{ id: "letter-version", units: letterUnits }] },
]) {
  return { company: "Northwind", role: "Product designer", documents };
}

describe("mobile application documents", () => {
  beforeEach(() => {
    state.application = application();
    state.findFirst.mockReset().mockImplementation(async () => state.application);
    state.loadDocuments.mockReset().mockResolvedValue({
      resume: { units: resumeUnits },
      letter: { units: letterUnits },
    });
    state.loadProfileName.mockReset().mockResolvedValue("Jane Doe");
    state.loadSettings.mockReset().mockResolvedValue({ fileNamePattern: "{name} – {company} – {doc}" });
    state.renderPdf.mockReset().mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  });

  it("returns the canonical resume and cover letter reading metadata", async () => {
    await expect(getMobileApplicationDocuments("app-1")).resolves.toEqual({
      resume: {
        id: "resume-doc",
        kind: "resume",
        label: "Resume",
        updatedAt: createdAt.toISOString(),
        currentVersionId: "resume-version",
        pdfUrl: "/api/mobile/v1/applications/app-1/documents/resume/pdf",
        units: resumeUnits,
      },
      coverLetter: {
        id: "letter-doc",
        kind: "cover-letter",
        label: "Cover letter",
        updatedAt: createdAt.toISOString(),
        currentVersionId: "letter-version",
        pdfUrl: "/api/mobile/v1/applications/app-1/documents/cover-letter/pdf",
        units: letterUnits,
      },
    });
    expect(state.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "app-1", awaitingReview: false } }));
    expect(state.loadDocuments).toHaveBeenCalledWith("app-1");
    expect(JSON.stringify(await getMobileApplicationDocuments("app-1"))).not.toMatch(/provider|apiKey|credential/i);
  });

  it("returns a null version ID when the live units differ from the latest saved snapshot", async () => {
    state.application = application([
      { id: "resume-doc", kind: DocumentKind.RESUME, units: [{ id: "summary", label: "Summary", text: "Older text" }], updatedAt: createdAt, versions: [{ id: "old-version", units: [{ id: "summary", label: "Summary", text: "Older text" }] }] },
    ]);

    await expect(getMobileApplicationDocuments("app-1")).resolves.toMatchObject({
      resume: { currentVersionId: null },
      coverLetter: null,
    });
  });

  it("returns null for an application unavailable to mobile", async () => {
    state.application = null;

    await expect(getMobileApplicationDocuments("missing")).resolves.toBeNull();
    expect(state.loadDocuments).not.toHaveBeenCalled();
  });

  it("returns meaningful not-found errors for missing applications and documents", async () => {
    state.application = null;
    await expect(getMobileApplicationDocument("missing", "resume")).rejects.toMatchObject({ code: "not_found", status: 404, message: "Application not found." });

    state.application = application([]);
    await expect(getMobileApplicationDocument("app-1", "cover-letter")).rejects.toMatchObject({
      code: "not_found",
      status: 404,
      message: "This application has no cover letter.",
    });
  });

  it("renders the canonical print page and applies the web PDF filename setting", async () => {
    const response = await exportMobileApplicationDocumentPdf("app-1", "cover-letter");

    expect(state.renderPdf).toHaveBeenCalledWith("/print/letter/app-1");
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("Jane%20Doe%20%E2%80%93%20Northwind%20%E2%80%93%20Cover%20letter.pdf");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
  });
});
