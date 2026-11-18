import "server-only";

import { z } from "zod";

import { extractedOf, extractedSchema, matchSchema } from "@/lib/application-data";
import { isAiConfigured } from "@/lib/ai/config";
import { loadApplicationRows } from "@/lib/applications-data";
import { DEFAULT_SORT } from "@/lib/applications-list";
import { prisma } from "@/lib/prisma";
import { loadProfile, loadProfileName } from "@/lib/profile-data";
import { invalidRequest, MobileApiError } from "@/lib/mobile/errors";
import type { MobileApplication, MobileApplicationSummary, MobileProfile, MobileSetup } from "@/lib/mobile/contracts";
import { isProfileReady, setupInProgress } from "@/lib/setup-guide";
import { loadSettings } from "@/lib/settings-data";

const PAGE_SIZE = 50;
const cursorSchema = z.object({ version: z.literal(1), updatedAt: z.number().int().nonnegative(), id: z.string().min(1).max(128) }).strict();

type Cursor = z.infer<typeof cursorSchema>;

function decodeCursor(value: string | undefined): Cursor | null {
  if (value === undefined) return null;
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalidRequest();
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown);
    if (!parsed.success) throw invalidRequest();
    return parsed.data;
  } catch (error) {
    if (error instanceof MobileApiError) throw error;
    throw invalidRequest();
  }
}

function encodeCursor(row: { updatedAt: number; id: string }): string {
  return Buffer.from(JSON.stringify({ version: 1, updatedAt: row.updatedAt, id: row.id }), "utf8").toString("base64url");
}

/** Reads from the shared Applications screen service, then pages its stable, updated-first result for v1. */
export async function listMobileApplications(cursorValue?: string): Promise<{
  items: MobileApplicationSummary[];
  nextCursor: string | null;
}> {
  const cursor = decodeCursor(cursorValue);
  const rows = await loadApplicationRows({ archived: false, sort: DEFAULT_SORT });
  const ordered = rows.toSorted((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));
  const remaining = cursor
    ? ordered.filter((row) => row.updatedAt < cursor.updatedAt || (row.updatedAt === cursor.updatedAt && row.id.localeCompare(cursor.id) < 0))
    : ordered;
  const page = remaining.slice(0, PAGE_SIZE + 1);
  const hasMore = page.length > PAGE_SIZE;
  const visible = page.slice(0, PAGE_SIZE);
  const items = visible.map((row): MobileApplicationSummary => ({
    id: row.id,
    company: row.company,
    role: row.role,
    location: row.location,
    mode: row.mode,
    status: row.status,
    archived: row.archived,
    match: row.match,
    score: row.match && row.match.total > 0 ? Math.round(100 * row.match.hit / row.match.total) : null,
    updatedAt: new Date(row.updatedAt).toISOString(),
  }));

  return {
    items,
    nextCursor: hasMore && visible.length > 0 ? encodeCursor(visible[visible.length - 1]) : null,
  };
}

export async function getMobileApplication(id: string): Promise<MobileApplication | null> {
  const application = await prisma.application.findFirst({
    where: { id, awaitingReview: false },
    select: {
      id: true,
      title: true,
      company: true,
      role: true,
      location: true,
      mode: true,
      salary: true,
      status: true,
      archivedAt: true,
      deadline: true,
      postingUrl: true,
      postingText: true,
      extracted: true,
      match: true,
      language: true,
      sentAt: true,
      nextInterviewAt: true,
      createdAt: true,
      updatedAt: true,
      notes: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, body: true, createdAt: true, updatedAt: true },
      },
    },
  });
  if (!application) return null;

  const extracted = extractedOf(application);
  const parsedMatch = matchSchema.safeParse(application.match);
  const safePostingUrl = /^https?:\/\//i.test(application.postingUrl) ? application.postingUrl : "";
  const iso = (date: Date | null) => date?.toISOString() ?? null;

  return {
    id: application.id,
    title: application.title,
    company: application.company,
    role: application.role,
    location: application.location,
    mode: application.mode,
    salary: application.salary,
    status: application.status,
    archived: application.archivedAt !== null,
    deadline: application.deadline?.toISOString().slice(0, 10) ?? null,
    postingUrl: safePostingUrl,
    postingText: application.postingText,
    language: application.language,
    sentAt: iso(application.sentAt),
    nextInterviewAt: iso(application.nextInterviewAt),
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
    notes: application.notes.map((note) => ({
      id: note.id,
      body: note.body,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    })),
    extracted: extractedSchema.parse(extracted),
    match: parsedMatch.success ? parsedMatch.data : null,
  };
}

/** V1 has no profile selector; details use the first profile, like Basics. */
export async function getMobileProfile(): Promise<MobileProfile> {
  return loadProfile();
}

/** Shares the web setup predicates and exposes only the three native welcome booleans. */
export async function getMobileSetup(): Promise<MobileSetup> {
  const [name, settings, aiConfigured] = await Promise.all([loadProfileName(), loadSettings(), isAiConfigured()]);
  return {
    profileReady: isProfileReady(name),
    aiConfigured,
    setupInProgress: setupInProgress(settings.setupGuide),
  };
}

export const MOBILE_LIST_PAGE_SIZE = PAGE_SIZE;
