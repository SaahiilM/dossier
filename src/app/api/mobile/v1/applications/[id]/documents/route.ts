import { authenticateMobileRequest } from "@/lib/mobile/device-sessions";
import { invalidRequest, MobileApiError, unauthorized } from "@/lib/mobile/errors";
import { mobileError, mobileJson } from "@/lib/mobile/http";
import { getMobileApplicationDocuments } from "@/lib/mobile/documents";

function validApplicationId(id: string): boolean {
  return /^[a-z0-9_-]{1,128}$/i.test(id) && id.trim() === id;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    if (!(await authenticateMobileRequest(request))) throw unauthorized();
    const { id } = await params;
    if (!validApplicationId(id)) throw invalidRequest();
    const documents = await getMobileApplicationDocuments(id);
    if (!documents) throw new MobileApiError("not_found", "Application not found.", 404);
    return mobileJson({ applicationId: id, documents });
  } catch (error) {
    return mobileError(error);
  }
}
