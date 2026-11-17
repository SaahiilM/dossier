import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CAPTURE_STATE_LABELS } from "@/lib/captures/domain";
import { getCapture } from "@/lib/captures/service";

import { CaptureDetailsForm } from "./capture-details-form";

export const metadata: Metadata = { title: "Capture details" };

export default async function CaptureDetailPage({ params }: PageProps<"/captures/[id]">) {
  const { id } = await params;
  const capture = await getCapture(id);
  if (!capture) notFound();

  return (
    <>
      <PageHeader
        title="Capture details"
        description="Review the saved link, add missing posting details, and continue to application preparation."
        before={
          <Link href="/captures" aria-label="Back to Capture Inbox" className="text-sm text-muted hover:text-ink">
            ← Inbox
          </Link>
        }
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-10 sm:px-10">
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">{CAPTURE_STATE_LABELS[capture.ingestionState]}</h2>
            <span className="text-label text-muted">Saved {capture.createdAt.toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
          </div>
          {capture.ingestionState === "NEEDS_DETAILS" && (
            <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
              This LinkedIn link is saved, but Dossier does not read LinkedIn automatically or use a logged-in session. Paste the official posting text or add its public employer link.
            </p>
          )}
          {capture.ingestionState === "SAVED" && !capture.text && !capture.canonicalEmployerUrl && (
            <p role="note" className="rounded-card bg-selected px-4 py-3 text-meta text-muted">
              The link is saved. Dossier has not looked up its posting details. Add the text or official employer link here, or continue and paste text in New application.
            </p>
          )}
          {capture.ingestionState === "FAILED" && (
            <p role="alert" className="rounded-card bg-danger-surface px-4 py-3 text-meta text-error">
              {capture.ingestionError || "The posting could not be processed. Add the text or official employer link to continue."}
            </p>
          )}
          <div>
            <p className="text-label font-medium text-muted">Original shared link</p>
            <a href={capture.originalUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-ink underline underline-offset-2">
              {capture.originalUrl}
            </a>
          </div>
          <p className="text-label text-muted">Source: {capture.source === "IOS_SHARE" ? "iOS share sheet" : "Web"}</p>
        </Card>
        <Card className="flex flex-col gap-4">
          <div>
            <h2 className="font-serif text-xl">Posting details</h2>
            <p className="mt-1 text-meta text-muted">Use text from the public employer posting. Adding a link does not fetch it automatically.</p>
          </div>
          <CaptureDetailsForm
            id={capture.id}
            initialText={capture.text}
            initialCanonicalEmployerUrl={capture.canonicalEmployerUrl}
          />
        </Card>
        <Link href="/captures" className={buttonClassName("text", "sm", "self-start underline underline-offset-2")}>
          Back to Capture Inbox
        </Link>
      </div>
    </>
  );
}
