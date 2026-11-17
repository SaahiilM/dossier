"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { createCaptureInputSchema, updateCaptureInputSchema } from "@/lib/captures/domain";
import { CaptureConflictError, CaptureNotFoundError, createCapture, updateCapture } from "@/lib/captures/service";

const webCreateSchema = createCaptureInputSchema.omit({ source: true });
const updateSchema = z
  .object({ id: z.string().min(1).max(100), ...updateCaptureInputSchema.shape })
  .refine((input) => input.text !== undefined || input.canonicalEmployerUrl !== undefined, "Add posting text or an official employer link to update.");

function actionError(error: unknown): never {
  if (error instanceof CaptureConflictError || error instanceof CaptureNotFoundError) throw new ActionError(error.message);
  throw error;
}

/** Save a link or user-pasted posting in the signed-in web capture Inbox. */
export const createCaptureAction = action(webCreateSchema, async (input) => {
  try {
    const capture = await createCapture({ ...input, source: "WEB" });
    revalidatePath("/captures");
    return capture;
  } catch (error) {
    actionError(error);
  }
});

/** Persist user-provided posting text and/or the official employer URL. */
export const updateCaptureAction = action(updateSchema, async ({ id, ...input }) => {
  try {
    const capture = await updateCapture(id, input);
    revalidatePath("/captures");
    revalidatePath(`/captures/${id}`);
    return capture;
  } catch (error) {
    actionError(error);
  }
});
