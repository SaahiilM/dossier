import { applicationNoteBodySchema, deleteApplicationNote, updateApplicationNote } from "@/lib/application-notes";
import { authenticateMobileRequest } from "@/lib/mobile/device-sessions";
import { invalidRequest, MobileApiError, unauthorized } from "@/lib/mobile/errors";
import { mobileError, mobileJson, parseBody, readJsonBody } from "@/lib/mobile/http";
import { z } from "zod";

const updateSchema = z.object({ body: applicationNoteBodySchema, expectedUpdatedAt: z.iso.datetime({ offset: true }) }).strict();
const deleteSchema = z.object({ expectedUpdatedAt: z.iso.datetime({ offset: true }) }).strict();
const MAX_NOTE_BODY_BYTES = 32_768;

function pathId(value: string): string {
  if (!value || value.length > 128 || value.trim() !== value) throw invalidRequest();
  return value;
}

function noteDto(note: { id: string; body: string; createdAt: Date; updatedAt: Date }) {
  return { ...note, createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString() };
}

function mutationError(outcome: "not-found" | "conflict"): MobileApiError {
  return outcome === "not-found"
    ? new MobileApiError("not_found", "Note not found.", 404)
    : new MobileApiError("conflict", "This note changed. Refresh it before saving.", 409);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
): Promise<Response> {
  try {
    if (!(await authenticateMobileRequest(request))) throw unauthorized();
    const { id: rawId, noteId: rawNoteId } = await params;
    const applicationId = pathId(rawId);
    const noteId = pathId(rawNoteId);
    const input = parseBody(updateSchema, await readJsonBody(request, MAX_NOTE_BODY_BYTES));
    const result = await updateApplicationNote({
      applicationId,
      noteId,
      body: input.body,
      expectedUpdatedAt: new Date(input.expectedUpdatedAt),
      mobileVisibleOnly: true,
    });
    if (result.outcome === "conflict" || result.outcome === "not-found") throw mutationError(result.outcome);
    return mobileJson({ note: noteDto(result.note) });
  } catch (error) {
    return mobileError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
): Promise<Response> {
  try {
    if (!(await authenticateMobileRequest(request))) throw unauthorized();
    const { id: rawId, noteId: rawNoteId } = await params;
    const applicationId = pathId(rawId);
    const noteId = pathId(rawNoteId);
    const input = parseBody(deleteSchema, await readJsonBody(request, MAX_NOTE_BODY_BYTES));
    const result = await deleteApplicationNote({
      applicationId,
      noteId,
      expectedUpdatedAt: new Date(input.expectedUpdatedAt),
      mobileVisibleOnly: true,
    });
    if (result.outcome === "conflict" || result.outcome === "not-found") throw mutationError(result.outcome);
    return mobileJson({ ok: true });
  } catch (error) {
    return mobileError(error);
  }
}
