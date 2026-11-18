import "server-only";

import { DocumentKind } from "@/generated/prisma/enums";
import { unitsSchema, type Unit } from "@/lib/application-data";
import { loadDocuments } from "@/lib/application-documents";
import { resolveFileName } from "@/lib/file-name";
import { MobileApiError } from "@/lib/mobile/errors";
import { pdfDownload } from "@/lib/pdf/downloads";
import { renderPdf } from "@/lib/pdf/render";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";

export type MobileDocumentKind = "resume" | "cover-letter";

export type MobileDocument = {
  id: string;
  kind: MobileDocumentKind;
  label: string;
  updatedAt: string;
  /** Present only when the newest saved snapshot has the same units as the live document. */
  currentVersionId: string | null;
  pdfUrl: string;
  units: Unit[];
};

type MobileDocumentState = {
  company: string;
  role: string;
  resume: MobileDocument | null;
  coverLetter: MobileDocument | null;
};

const definitions = {
  resume: {
    kind: DocumentKind.RESUME,
    label: "Resume",
    printPath: "resume",
    fileKind: DocumentKind.RESUME,
  },
  "cover-letter": {
    kind: DocumentKind.COVER_LETTER,
    label: "Cover letter",
    printPath: "letter",
    fileKind: DocumentKind.COVER_LETTER,
  },
} as const satisfies Record<MobileDocumentKind, {
  kind: DocumentKind;
  label: string;
  printPath: string;
  fileKind: DocumentKind;
}>;

const noApplication = () => new MobileApiError("not_found", "Application not found.", 404);

function noDocument(kind: MobileDocumentKind): MobileApiError {
  return new MobileApiError(
    "not_found",
    kind === "resume" ? "This application has no tailored resume." : "This application has no cover letter.",
    404,
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Loads the web document model, plus narrowly selected IDs needed by the native read contract. */
async function loadMobileDocumentState(applicationId: string): Promise<MobileDocumentState | null> {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, awaitingReview: false },
    select: {
      company: true,
      role: true,
      documents: {
        where: { kind: { in: [DocumentKind.RESUME, DocumentKind.COVER_LETTER] } },
        select: {
          id: true,
          kind: true,
          units: true,
          updatedAt: true,
          versions: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { id: true, units: true },
          },
        },
      },
    },
  });
  if (!application) return null;

  // The print pages and application UI share this loader, including frozen sent copies and themes.
  const loaded = await loadDocuments(applicationId);
  const records = new Map(application.documents.map((document) => [document.kind, document]));
  const toDto = (kind: MobileDocumentKind, units: Unit[] | null): MobileDocument | null => {
    const definition = definitions[kind];
    const record = records.get(definition.kind);
    if (!record || !units) return null;
    const newest = record.versions[0];
    const savedUnits = newest ? unitsSchema.safeParse(newest.units) : null;
    return {
      id: record.id,
      kind,
      label: definition.label,
      updatedAt: record.updatedAt.toISOString(),
      currentVersionId: newest && savedUnits?.success && sameJson(savedUnits.data, units) ? newest.id : null,
      pdfUrl: `/api/mobile/v1/applications/${encodeURIComponent(applicationId)}/documents/${kind}/pdf`,
      units,
    };
  };

  return {
    company: application.company,
    role: application.role,
    resume: toDto("resume", loaded.resume?.units ?? null),
    coverLetter: toDto("cover-letter", loaded.letter?.units ?? null),
  };
}

/** Lists the current tailored reading content and metadata; absent documents are `null`. */
export async function getMobileApplicationDocuments(applicationId: string): Promise<{
  resume: MobileDocument | null;
  coverLetter: MobileDocument | null;
} | null> {
  const state = await loadMobileDocumentState(applicationId);
  if (!state) return null;
  return { resume: state.resume, coverLetter: state.coverLetter };
}

/** Reads one current document, returning 404 for an unavailable application or missing document. */
export async function getMobileApplicationDocument(
  applicationId: string,
  kind: MobileDocumentKind,
): Promise<MobileDocument> {
  const state = await loadMobileDocumentState(applicationId);
  if (!state) throw noApplication();
  const document = kind === "resume" ? state.resume : state.coverLetter;
  if (!document) throw noDocument(kind);
  return document;
}

/** Exports through the same print page, Chromium renderer, and filename settings as the web download. */
export async function exportMobileApplicationDocumentPdf(
  applicationId: string,
  kind: MobileDocumentKind,
): Promise<Response> {
  const state = await loadMobileDocumentState(applicationId);
  if (!state) throw noApplication();
  const document = kind === "resume" ? state.resume : state.coverLetter;
  if (!document) throw noDocument(kind);

  const [name, settings] = await Promise.all([loadProfileName(), loadSettings()]);
  const definition = definitions[kind];
  const pdf = await renderPdf(`/print/${definition.printPath}/${encodeURIComponent(applicationId)}`);
  const response = pdfDownload(
    pdf,
    resolveFileName(settings.fileNamePattern, {
      name,
      company: state.company,
      role: state.role,
      doc: definition.fileKind,
      date: new Date(),
    }),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
