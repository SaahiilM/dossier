import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CAPTURE_STATE_LABELS } from "@/lib/captures/domain";
import { listCaptures } from "@/lib/captures/service";

import { CreateCaptureForm } from "./create-capture-form";

export const metadata: Metadata = { title: "Capture Inbox" };

export default async function CapturesPage() {
  const { items } = await listCaptures({ limit: 100 });
  return (
    <>
      <PageHeader
        title="Capture Inbox"
        description="Keep job links and posting text together, then continue in the existing application preparation flow."
        actions={
          <Link href="#new-capture" className={buttonClassName("secondary", "sm")}>
            Add capture
          </Link>
        }
      />
      <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 pb-10 sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
        <section aria-labelledby="capture-list-heading" className="flex flex-col gap-4">
          <h2 id="capture-list-heading" className="font-serif text-xl">Saved captures</h2>
          {items.length === 0 ? (
            <Card className="flex flex-col items-start gap-3">
              <h3 className="font-medium">Your capture Inbox is empty</h3>
              <p className="text-meta text-muted">Save a job link or paste its posting. You can add missing details later.</p>
              <Link href="#new-capture" className={buttonClassName("secondary", "sm")}>
                Add your first capture
              </Link>
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((capture) => (
                <li key={capture.id}>
                  <Link href={`/captures/${encodeURIComponent(capture.id)}`} className="block rounded-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                    <Card className="flex flex-col gap-3 transition-colors hover:border-line-strong">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="min-w-0 break-all font-medium">{captureTitle(capture.originalUrl)}</h3>
                        <span className={stateClass(capture.ingestionState)}>{CAPTURE_STATE_LABELS[capture.ingestionState]}</span>
                      </div>
                      <p className="break-all text-meta text-muted">{capture.originalUrl}</p>
                      {capture.text ? <p className="line-clamp-3 whitespace-pre-line text-sm text-ink">{capture.text}</p> : <p className="text-sm text-muted">No posting text yet.</p>}
                      <p className="text-label text-muted">Saved {capture.createdAt.toLocaleDateString(undefined, { dateStyle: "medium" })}</p>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {items.length === 100 && <p className="text-label text-muted">Showing the 100 most recently updated captures.</p>}
        </section>
        <div className="flex flex-col gap-4">
          <CreateCaptureForm />
          <Card className="flex flex-col gap-2">
            <h2 className="font-medium">About job links</h2>
            <p className="text-meta text-muted">
              Dossier does not discover job details automatically or access LinkedIn behind a login. For a LinkedIn share, paste the official posting text or add its public employer link. Fetching a public link happens only when you choose Fetch in New application.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

function captureTitle(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return "Saved job link";
  }
}

function stateClass(state: keyof typeof CAPTURE_STATE_LABELS): string {
  const color = state === "READY" ? "bg-selected text-success" : state === "FAILED" ? "bg-danger-surface text-error" : state === "NEEDS_DETAILS" ? "bg-warning-surface text-warning" : "bg-paper text-muted";
  return `rounded-full px-2.5 py-1 text-label font-medium ${color}`;
}
