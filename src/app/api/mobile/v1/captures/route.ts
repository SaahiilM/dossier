import { CaptureConflictError, CaptureNotFoundError, createCapture, listCaptures } from "@/lib/captures/service";
import { createCaptureInputSchema } from "@/lib/captures/domain";
import { authenticateMobileRequest } from "@/lib/mobile/device-sessions";
import { invalidRequest, MobileApiError, unauthorized } from "@/lib/mobile/errors";
import { mobileError, mobileJson, parseBody, readJsonBody } from "@/lib/mobile/http";

const requestSchema = createCaptureInputSchema.pick({ url: true, text: true, note: true, clientRequestId: true }).strict();
// Allow the maximum posting text even when JSON escapes each UTF-16 code unit.
const MAX_CAPTURE_BODY_BYTES = 640_000;

function captureDto(row: Awaited<ReturnType<typeof createCapture>>) {
  return {
    id: row.id,
    url: row.originalUrl,
    text: row.text,
    note: row.note,
    state: row.ingestionState,
    canonicalEmployerUrl: row.canonicalEmployerUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    if (!(await authenticateMobileRequest(request))) throw unauthorized();
    const params = new URL(request.url).searchParams;
    const cursor = params.get("cursor");
    if (params.size > (cursor === null ? 0 : 1) || cursor === "" || (cursor?.length ?? 0) > 100) throw invalidRequest();
    const page = await listCaptures({ cursor: cursor ?? undefined });
    return mobileJson({ items: page.items.map(captureDto), nextCursor: page.nextCursor });
  } catch (error) {
    if (error instanceof CaptureNotFoundError) {
      return mobileError(new MobileApiError("not_found", "That capture page is unavailable. Refresh the Inbox.", 404));
    }
    return mobileError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!(await authenticateMobileRequest(request))) throw unauthorized();
    const input = parseBody(requestSchema, await readJsonBody(request, MAX_CAPTURE_BODY_BYTES));
    const capture = await createCapture({ ...input, source: "IOS_SHARE" });
    return mobileJson({ capture: captureDto(capture) });
  } catch (error) {
    if (error instanceof CaptureConflictError) {
      return mobileError(new MobileApiError("conflict", "This posting is already in the capture Inbox.", 409));
    }
    return mobileError(error);
  }
}
