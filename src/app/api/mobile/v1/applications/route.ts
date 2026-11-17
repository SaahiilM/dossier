import { authenticateMobileRequest } from "@/lib/mobile/device-sessions";
import { invalidRequest, unauthorized } from "@/lib/mobile/errors";
import { mobileError, mobileJson } from "@/lib/mobile/http";
import { listMobileApplications } from "@/lib/mobile/resources";

export async function GET(request: Request): Promise<Response> {
  try {
    if (!(await authenticateMobileRequest(request))) throw unauthorized();
    const url = new URL(request.url);
    if (url.searchParams.size > 1 || url.searchParams.getAll("cursor").length > 1) throw invalidRequest();
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const result = await listMobileApplications(cursor);
    return mobileJson(result);
  } catch (error) {
    return mobileError(error);
  }
}
