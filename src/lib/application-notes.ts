import "server-only";

import type { Note, PrismaClient } from "@/generated/prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

/** The web Notes tab's rule for adding and editing a private note. */
export const applicationNoteBodySchema = z.string().trim().min(1, "Write something first.").max(5000);

export type ApplicationNoteDto = Pick<Note, "id" | "body" | "createdAt" | "updatedAt">;
type NoteDb = Pick<PrismaClient, "$transaction">;

type NoteMutationResult =
  | { outcome: "saved"; note: ApplicationNoteDto }
  | { outcome: "deleted"; note: ApplicationNoteDto }
  | { outcome: "not-found" }
  | { outcome: "conflict" };

type NoteAccess = { applicationId: string; noteId: string; mobileVisibleOnly?: boolean };

function noteWhere({ applicationId, noteId, mobileVisibleOnly }: NoteAccess) {
  return {
    id: noteId,
    applicationId,
    ...(mobileVisibleOnly ? { application: { awaitingReview: false } } : {}),
  };
}

/** Create one private, non-AI note on an existing application. */
export async function addApplicationNote(
  applicationId: string,
  body: string,
  options: { db?: NoteDb; mobileVisibleOnly?: boolean } = {},
): Promise<ApplicationNoteDto | null> {
  const cleanBody = applicationNoteBodySchema.parse(body);
  const db = (options.db ?? prisma) as PrismaClient;

  return db.$transaction(async (tx) => {
    const application = await tx.application.findFirst({
      where: { id: applicationId, ...(options.mobileVisibleOnly ? { awaitingReview: false } : {}) },
      select: { id: true },
    });
    if (!application) return null;

    return tx.note.create({ data: { applicationId, body: cleanBody }, select: { id: true, body: true, createdAt: true, updatedAt: true } });
  });
}

/** Update only the named application's note if that note version is current. */
export async function updateApplicationNote(
  input: NoteAccess & { body: string; expectedUpdatedAt: Date },
  options: { db?: NoteDb } = {},
): Promise<NoteMutationResult> {
  const body = applicationNoteBodySchema.parse(input.body);
  const db = (options.db ?? prisma) as PrismaClient;
  const where = noteWhere(input);

  return db.$transaction(async (tx) => {
    const { count } = await tx.note.updateMany({
      where: { ...where, updatedAt: input.expectedUpdatedAt },
      data: { body },
    });
    if (count === 1) {
      const note = await tx.note.findFirstOrThrow({ where, select: { id: true, body: true, createdAt: true, updatedAt: true } });
      return { outcome: "saved", note };
    }

    const current = await tx.note.findFirst({ where, select: { id: true } });
    return current ? { outcome: "conflict" } : { outcome: "not-found" };
  });
}

/** Delete only the named application's note if that note version is current. */
export async function deleteApplicationNote(
  input: NoteAccess & { expectedUpdatedAt: Date },
  options: { db?: NoteDb } = {},
): Promise<NoteMutationResult> {
  const db = (options.db ?? prisma) as PrismaClient;
  const where = noteWhere(input);

  return db.$transaction(async (tx) => {
    const current = await tx.note.findFirst({ where, select: { id: true, body: true, createdAt: true, updatedAt: true } });
    if (!current) return { outcome: "not-found" };

    const { count } = await tx.note.deleteMany({ where: { ...where, updatedAt: input.expectedUpdatedAt } });
    if (count === 1) return { outcome: "deleted", note: current };

    const stillExists = await tx.note.findFirst({ where, select: { id: true } });
    return stillExists ? { outcome: "conflict" } : { outcome: "not-found" };
  });
}
