import { authenticateMobileRequest } from "@/lib/mobile/device-sessions";
import { unauthorized } from "@/lib/mobile/errors";
import { mobileError, mobileJson, parseBody, readJsonBody } from "@/lib/mobile/http";
import { patchProfileBasics, profileBasicsSchema, readProfileBasics } from "@/lib/profile-basics";

const patchSchema = profileBasicsSchema.partial().strict().refine((patch) => Object.keys(patch).length > 0);

export async function GET(request: Request): Promise<Response> {
  try {
    if (!(await authenticateMobileRequest(request))) throw unauthorized();
    return mobileJson({ basics: await readProfileBasics() });
  } catch (error) {
    return mobileError(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    if (!(await authenticateMobileRequest(request))) throw unauthorized();
    const patch = parseBody(patchSchema, await readJsonBody(request, 65_536));
    return mobileJson({ basics: await patchProfileBasics(patch) });
  } catch (error) {
    return mobileError(error);
  }
}
