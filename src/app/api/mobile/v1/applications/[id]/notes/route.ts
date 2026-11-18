import { addApplicationNote, applicationNoteBodySchema } from "@/lib/application-notes";
import { authenticateMobileRequest } from "@/lib/mobile/device-sessions";
import { invalidRequest, MobileApiError, unauthorized } from "@/lib/mobile/errors";
import { mobileError, mobileJson, parseBody, readJsonBody } from "@/lib/mobile/http";
import { z } from "zod";

const createSchema = z.object({ body: applicationNoteBodySchema }).strict();
const MAX_NOTE_BODY_BYTES = 32_768;

function pathId(value: string): string {
  if (!value || value.length > 128 || value.trim() !== value) throw invalidRequest();
  return value;
}

function noteDto(note: { id: string; body: string; createdAt: Date; updatedAt: Date }) {
  return { ...note, createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString() };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    if (!(await authenticateMobileRequest(request))) throw unauthorized();
    const { id: rawId } = await params;
    const id = pathId(rawId);
    const { body } = parseBody(createSchema, await readJsonBody(request, MAX_NOTE_BODY_BYTES));
    const note = await addApplicationNote(id, body, { mobileVisibleOnly: true });
    if (!note) throw new MobileApiError("not_found", "Application not found.", 404);
    return mobileJson({ note: noteDto(note) });
  } catch (error) {
    return mobileError(error);
  }
}
