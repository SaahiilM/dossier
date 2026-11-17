import { authenticateMobileRequest } from "@/lib/mobile/device-sessions";
import { invalidRequest, unauthorized, MobileApiError } from "@/lib/mobile/errors";
import { mobileError, mobileJson } from "@/lib/mobile/http";
import { getMobileApplication } from "@/lib/mobile/resources";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    if (!(await authenticateMobileRequest(request))) throw unauthorized();
    const { id } = await params;
    if (!id || id.length > 128 || id.trim() !== id) throw invalidRequest();
    const application = await getMobileApplication(id);
    if (!application) throw new MobileApiError("not_found", "Application not found.", 404);
    return mobileJson({ application });
  } catch (error) {
    return mobileError(error);
  }
}
