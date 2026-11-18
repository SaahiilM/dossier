import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticate: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  exportPdf: vi.fn(),
}));

vi.mock("@/lib/mobile/device-sessions", () => ({ authenticateMobileRequest: (...args: unknown[]) => state.authenticate(...args) }));
vi.mock("@/lib/mobile/documents", () => ({
  getMobileApplicationDocuments: (...args: unknown[]) => state.list(...args),
  getMobileApplicationDocument: (...args: unknown[]) => state.read(...args),
  exportMobileApplicationDocumentPdf: (...args: unknown[]) => state.exportPdf(...args),
}));

import { MobileApiError } from "@/lib/mobile/errors";
import { GET as listDocuments } from "./route";
import { GET as readDocument } from "./[kind]/route";
import { GET as exportPdf } from "./[kind]/pdf/route";

const request = new Request("https://dossier.example/api/mobile/v1/applications/app-1/documents", {
  headers: { authorization: `Bearer ${"A".repeat(43)}` },
});

describe("mobile application document routes", () => {
  beforeEach(() => {
    state.authenticate.mockReset().mockResolvedValue({ id: "session-1" });
    state.list.mockReset().mockResolvedValue({ resume: null, coverLetter: null });
    state.read.mockReset().mockResolvedValue({ id: "resume-doc", kind: "resume", units: [] });
    state.exportPdf.mockReset().mockResolvedValue(new Response(new Uint8Array([37, 80, 68, 70]), {
      headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=resume.pdf", "cache-control": "no-store" },
    }));
  });

  it("requires bearer authentication before returning the no-store document list", async () => {
    state.authenticate.mockResolvedValue(null);
    const denied = await listDocuments(request, { params: Promise.resolve({ id: "app-1" }) });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(await denied.json()).toEqual({ error: { code: "unauthorized", message: "Sign in to continue." } });
    expect(state.list).not.toHaveBeenCalled();

    state.authenticate.mockResolvedValue({ id: "session-1" });
    const response = await listDocuments(request, { params: Promise.resolve({ id: "app-1" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ applicationId: "app-1", documents: { resume: null, coverLetter: null } });
    expect(state.list).toHaveBeenCalledWith("app-1");
  });

  it("requires bearer authentication for document reads and PDF exports", async () => {
    state.authenticate.mockResolvedValue(null);
    const context = { params: Promise.resolve({ id: "app-1", kind: "resume" }) };

    const read = await readDocument(request, context);
    const pdf = await exportPdf(request, context);

    for (const response of [read, pdf]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
    }
    expect(state.read).not.toHaveBeenCalled();
    expect(state.exportPdf).not.toHaveBeenCalled();
  });

  it("maps an unavailable application to the standard not-found response", async () => {
    state.list.mockResolvedValue(null);
    const response = await listDocuments(request, { params: Promise.resolve({ id: "missing" }) });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: { code: "not_found", message: "Application not found." } });
  });

  it("reads only supported document kinds and preserves missing-document errors", async () => {
    const context = { params: Promise.resolve({ id: "app-1", kind: "resume" }) };
    const response = await readDocument(request, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ document: { id: "resume-doc", kind: "resume", units: [] } });
    expect(state.read).toHaveBeenCalledWith("app-1", "resume");

    state.read.mockRejectedValueOnce(new MobileApiError("not_found", "This application has no cover letter.", 404));
    const missing = await readDocument(request, { params: Promise.resolve({ id: "app-1", kind: "cover-letter" }) });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "not_found", message: "This application has no cover letter." } });

    const invalid = await readDocument(request, { params: Promise.resolve({ id: "app-1", kind: "email" }) });
    expect(invalid.status).toBe(400);
    expect(state.read).toHaveBeenCalledTimes(2);
  });

  it("returns canonical PDFs as no-store attachments", async () => {
    const response = await exportPdf(request, { params: Promise.resolve({ id: "app-1", kind: "cover-letter" }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe("attachment; filename=resume.pdf");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(state.exportPdf).toHaveBeenCalledWith("app-1", "cover-letter");
  });
});
