import { authenticateMobileRequest, revokeMobileDeviceSession } from "@/lib/mobile/device-sessions";
import { mobileError, mobileJson, requireEmptyBody } from "@/lib/mobile/http";
import { unauthorized } from "@/lib/mobile/errors";

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await authenticateMobileRequest(request);
    if (!session) throw unauthorized();
    await requireEmptyBody(request);
    await revokeMobileDeviceSession(session.id);
    return mobileJson({ ok: true });
  } catch (error) {
    return mobileError(error);
  }
}
