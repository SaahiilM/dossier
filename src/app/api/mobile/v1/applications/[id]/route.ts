import { ApplicationStatus } from "@/generated/prisma/enums";
import { applyStatusChange } from "@/lib/status-changes";
import { authenticateMobileRequest } from "@/lib/mobile/device-sessions";
import { invalidRequest, unauthorized, MobileApiError } from "@/lib/mobile/errors";
import { mobileError, mobileJson, parseBody, readJsonBody } from "@/lib/mobile/http";
import { prisma } from "@/lib/prisma";
import { getMobileApplication } from "@/lib/mobile/resources";
import { z } from "zod";

const patchSchema = z.object({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  status: z.enum(ApplicationStatus),
}).strict();

const MAX_PATCH_BODY_BYTES = 2_048;

function applicationId(value: string): string {
  if (!value || value.length > 128 || value.trim() !== value) throw invalidRequest();
  return value;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    if (!(await authenticateMobileRequest(request))) throw unauthorized();
    const { id } = await params;
    applicationId(id);
    const application = await getMobileApplication(id);
    if (!application) throw new MobileApiError("not_found", "Application not found.", 404);
    return mobileJson({ application });
  } catch (error) {
    return mobileError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    if (!(await authenticateMobileRequest(request))) throw unauthorized();
    const { id: rawId } = await params;
    const id = applicationId(rawId);
    const input = parseBody(patchSchema, await readJsonBody(request, MAX_PATCH_BODY_BYTES));
    const result = await applyStatusChange(prisma, id, input.status, new Date(), new Date(input.expectedUpdatedAt));
    if (result.outcome === "conflict") {
      throw new MobileApiError("conflict", "This application changed. Refresh it before saving.", 409);
    }
    if (result.outcome === "not-found") throw new MobileApiError("not_found", "Application not found.", 404);

    const application = await getMobileApplication(id);
    if (!application) throw new MobileApiError("not_found", "Application not found.", 404);
    return mobileJson({ application });
  } catch (error) {
    return mobileError(error);
  }
}
