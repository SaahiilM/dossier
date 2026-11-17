import { clientIp } from "@/lib/auth/client-ip";
import { startLoginAttempt } from "@/lib/auth/login-throttle";
import { passwordMatches } from "@/lib/auth/session";
import { tooManyAttemptsMessage } from "@/lib/auth/throttle";
import { prisma } from "@/lib/prisma";
import { createMobileDeviceSession } from "@/lib/mobile/device-sessions";
import { MobileApiError } from "@/lib/mobile/errors";
import { mobileError, mobileJson, parseBody, readJsonBody, requireSecureTransport } from "@/lib/mobile/http";
import { mobileLoginRequestSchema } from "@/lib/mobile/contracts";

const MAX_LOGIN_BODY_BYTES = 8_192;

export async function POST(request: Request): Promise<Response> {
  try {
    requireSecureTransport(request);
    const input = parseBody(mobileLoginRequestSchema, await readJsonBody(request, MAX_LOGIN_BODY_BYTES));
    const attempt = await startLoginAttempt(prisma, { ip: clientIp(request.headers), browser: null });
    if (!attempt.allowed) {
      throw new MobileApiError(
        "rate_limited",
        tooManyAttemptsMessage(attempt.waitMs),
        429,
        Math.max(1, Math.ceil(attempt.waitMs / 1_000)),
      );
    }

    if (!(await passwordMatches(input.password))) {
      throw new MobileApiError("invalid_credentials", "The password is incorrect.", 401);
    }
    await attempt.succeeded();

    const session = await createMobileDeviceSession(input.deviceName ?? "Mobile device");
    return mobileJson(session);
  } catch (error) {
    return mobileError(error);
  }
}
