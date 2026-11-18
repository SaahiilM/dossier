import { authenticateMobileRequest } from "@/lib/mobile/device-sessions";
import { invalidRequest, unauthorized } from "@/lib/mobile/errors";
import { mobileError, mobileJson } from "@/lib/mobile/http";
import { getMobileApplicationDocument, type MobileDocumentKind } from "@/lib/mobile/documents";

function documentKind(value: string): MobileDocumentKind {
  if (value === "resume" || value === "cover-letter") return value;
  throw invalidRequest();
}

function validApplicationId(id: string): boolean {
  return /^[a-z0-9_-]{1,128}$/i.test(id) && id.trim() === id;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; kind: string }> },
): Promise<Response> {
  try {
    if (!(await authenticateMobileRequest(request))) throw unauthorized();
    const { id, kind: rawKind } = await params;
    if (!validApplicationId(id)) throw invalidRequest();
    const document = await getMobileApplicationDocument(id, documentKind(rawKind));
    return mobileJson({ document });
  } catch (error) {
    return mobileError(error);
  }
}
