import { authenticateMobileRequest } from "@/lib/mobile/device-sessions";
import { unauthorized } from "@/lib/mobile/errors";
import { mobileError, mobileJson } from "@/lib/mobile/http";
import { getMobileSetup } from "@/lib/mobile/resources";

export async function GET(request: Request): Promise<Response> {
  try {
    if (!(await authenticateMobileRequest(request))) throw unauthorized();
    return mobileJson(await getMobileSetup());
  } catch (error) {
    return mobileError(error);
  }
}
