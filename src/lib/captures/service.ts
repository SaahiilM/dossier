import "server-only";

import { prisma } from "@/lib/prisma";

import {
  canonicalCaptureUrl,
  captureIngestionState,
  captureListOptionsSchema,
  createCaptureInputSchema,
  normalizeCaptureUrl,
  updateCaptureInputSchema,
  type CreateCaptureInput,
  type UpdateCaptureInput,
} from "./domain";

export class CaptureNotFoundError extends Error {
  override name = "CaptureNotFoundError";
}

export class CaptureConflictError extends Error {
  override name = "CaptureConflictError";
}

const isUniqueConflict = (error: unknown) => (error as { code?: unknown } | null)?.code === "P2002";
type CaptureRecord = NonNullable<Awaited<ReturnType<typeof prisma.capture.findUnique>>>;

function stateFor(input: { originalUrl: string; text: string; canonicalEmployerUrl: string }) {
  return captureIngestionState(input);
}

/** Save one link or pasted posting. Repeated request IDs and canonical URLs return one record. */
export async function createCapture(input: CreateCaptureInput) {
  const parsed = createCaptureInputSchema.parse(input);
  const { url: originalUrl, ...captureFields } = parsed;
  const canonicalEmployerUrl = parsed.canonicalEmployerUrl ? normalizeCaptureUrl(parsed.canonicalEmployerUrl) : "";
  const dedupeUrl = canonicalCaptureUrl(canonicalEmployerUrl || originalUrl);
  const data = {
    ...captureFields,
    originalUrl,
    canonicalEmployerUrl,
    dedupeUrl,
    ingestionState: stateFor({ originalUrl, text: parsed.text, canonicalEmployerUrl }),
  };

  const byRequestId = await prisma.capture.findUnique({ where: { clientRequestId: parsed.clientRequestId } });
  if (byRequestId) return byRequestId;

  const existing = await prisma.capture.findUnique({ where: { dedupeUrl } });
  if (existing) return mergeDuplicate(existing, data);

  try {
    return await prisma.capture.create({ data });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    // Another request may have won either uniqueness race. Re-read the winner
    // and preserve its original shared URL while adding only missing user data.
    const winner =
      (await prisma.capture.findUnique({ where: { clientRequestId: parsed.clientRequestId } })) ??
      (await prisma.capture.findUnique({ where: { dedupeUrl } }));
    if (!winner) throw error;
    return mergeDuplicate(winner, data);
  }
}

async function mergeDuplicate(
  existing: CaptureRecord,
  incoming: {
    clientRequestId: string;
    originalUrl: string;
    canonicalEmployerUrl: string;
    text: string;
    note: string;
  },
) {
  // An exact retry never changes the record, even if a client accidentally
  // reuses its request ID with different data.
  if (existing.clientRequestId === incoming.clientRequestId) return existing;

  const text = existing.text || incoming.text;
  const note = existing.note || incoming.note;
  const canonicalEmployerUrl = existing.canonicalEmployerUrl || incoming.canonicalEmployerUrl;
  const ingestionState = stateFor({ originalUrl: existing.originalUrl, text, canonicalEmployerUrl });
  if (text === existing.text && note === existing.note && canonicalEmployerUrl === existing.canonicalEmployerUrl && ingestionState === existing.ingestionState) {
    return existing;
  }
  try {
    return await prisma.capture.update({
      where: { id: existing.id },
      data: { text, note, canonicalEmployerUrl, ingestionState, ingestionError: "" },
    });
  } catch (error) {
    if (isUniqueConflict(error)) throw new CaptureConflictError("That employer posting is already in your capture Inbox.");
    throw error;
  }
}

/** A private page of captures, newest updated first. */
export async function listCaptures(options: { limit?: number; cursor?: string } = {}) {
  const { limit, cursor } = captureListOptionsSchema.parse(options);
  if (cursor && !(await prisma.capture.findUnique({ where: { id: cursor }, select: { id: true } }))) {
    throw new CaptureNotFoundError("That capture page is no longer available. Refresh the Inbox.");
  }
  const rows = await prisma.capture.findMany({
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: limit + 1,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
}

/** Read one capture by its server-generated ID. */
export async function getCapture(id: string) {
  return prisma.capture.findUnique({ where: { id } });
}

/** Add or correct user-provided posting text or an official employer link. */
export async function updateCapture(id: string, input: UpdateCaptureInput) {
  const parsed = updateCaptureInputSchema.parse(input);
  const current = await getCapture(id);
  if (!current) throw new CaptureNotFoundError("That capture is no longer available.");

  const text = parsed.text ?? current.text;
  const canonicalEmployerUrl =
    parsed.canonicalEmployerUrl === undefined
      ? current.canonicalEmployerUrl
      : parsed.canonicalEmployerUrl
        ? normalizeCaptureUrl(parsed.canonicalEmployerUrl)
        : "";
  const dedupeUrl = canonicalCaptureUrl(canonicalEmployerUrl || current.originalUrl);

  try {
    return await prisma.capture.update({
      where: { id },
      data: {
        text,
        canonicalEmployerUrl,
        dedupeUrl,
        ingestionState: stateFor({ originalUrl: current.originalUrl, text, canonicalEmployerUrl }),
        ingestionError: "",
      },
    });
  } catch (error) {
    if (isUniqueConflict(error)) throw new CaptureConflictError("That employer posting is already in your capture Inbox.");
    throw error;
  }
}

/** Record a user-safe failure for a future explicit ingestion attempt. */
export async function markCaptureFailed(id: string, reason: string) {
  const capture = await getCapture(id);
  if (!capture) throw new CaptureNotFoundError("That capture is no longer available.");
  const ingestionError = reason.trim().slice(0, 500) || "The posting could not be processed.";
  return prisma.capture.update({ where: { id }, data: { ingestionState: "FAILED", ingestionError } });
}
