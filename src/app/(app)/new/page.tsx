import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isAiConfigured, isAiUsable } from "@/lib/ai/config";
import { handsOffToClaude } from "@/lib/connector/handoff";
import { getCapture } from "@/lib/captures/service";
import { DEMO_POSTING } from "@/lib/demo-profile";
import { postingText } from "@/lib/job-search/search";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { getStartup, startupPostingText } from "@/lib/startups/store";

import { NewApplication } from "./new-application";

export const metadata: Metadata = { title: "New application" };

/** Posting → details and match → tailored documents (PRD §6.4). Nothing is created until the last step. */
export default async function NewApplicationPage({ searchParams }: PageProps<"/new">) {
  const { fresh, posting, startup: startupId, capture: captureIdParam } = await searchParams;
  const captureId = typeof captureIdParam === "string" ? captureIdParam : undefined;
  const [aiReady, writeInClaude, applications, settings, fromFindJobs, startup, capture] = await Promise.all([
    isAiConfigured(),
    isAiUsable().then(handsOffToClaude),
    prisma.application.count({ where: { awaitingReview: false } }),
    loadSettings(),
    // "Start application" on Find jobs (E14-8).
    typeof posting === "string" ? prisma.posting.findUnique({ where: { id: posting } }) : null,
    // "Write to them" on Startups (#222): what's known about the startup, without its addresses.
    typeof startupId === "string" ? getStartup(startupId) : null,
    captureId ? getCapture(captureId) : null,
  ]);
  if (captureId && !capture) notFound();
  return (
    <NewApplication
      aiReady={aiReady}
      writeInClaude={writeInClaude}
      defaultTone={settings.defaultTone}
      defaultWrite={settings.documentsToWrite}
      fresh={fresh !== undefined}
      fromPosting={
        !capture
          ? fromFindJobs
            ? { id: fromFindJobs.id, text: postingText(fromFindJobs), url: fromFindJobs.url, complete: fromFindJobs.complete }
            : startup
              ? {
              id: null,
              startup: { id: startup.id, company: startup.company },
              text: startupPostingText(startup),
              url: startup.links[0]?.url ?? startup.website,
              complete: true,
            }
              : null
          : null
      }
      fromCapture={
        capture
          ? { text: capture.text, canonicalEmployerUrl: capture.canonicalEmployerUrl }
          : null
      }
      // A first-run helper: only until the first application exists (E7-1).
      samplePosting={applications === 0 ? DEMO_POSTING : null}
    />
  );
}
