"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createCaptureAction } from "./actions";

export function CreateCaptureForm() {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    requestId.current ??= crypto.randomUUID();
    setPending(true);
    setError(null);
    try {
      const result = await createCaptureAction({
        url: String(form.get("url") ?? ""),
        canonicalEmployerUrl: String(form.get("canonicalEmployerUrl") ?? ""),
        text: String(form.get("text") ?? ""),
        note: String(form.get("note") ?? ""),
        clientRequestId: requestId.current,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      requestId.current = null;
      router.push(`/captures/${encodeURIComponent(result.data.id)}`);
    } catch {
      setError("The capture could not be saved. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card id="new-capture" className="flex flex-col gap-5">
      <div>
        <h2 className="font-serif text-xl">Add a capture</h2>
        <p className="mt-1 text-meta text-muted">Save a shared link, paste the posting, or add its official employer link.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Input
          name="url"
          label="Shared link"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://…"
          maxLength={2048}
          required
        />
        <Input
          name="canonicalEmployerUrl"
          label="Official employer posting link (optional)"
          type="url"
          inputMode="url"
          placeholder="https://careers.example/jobs/…"
          maxLength={2048}
          hint="Use the employer or hiring platform's public posting page."
        />
        <Textarea
          name="text"
          label="Posting text (optional)"
          rows={8}
          maxLength={100000}
          placeholder="Paste the official job posting text if you have it."
          hint="LinkedIn links are saved without automatic discovery. Paste the posting or add the official employer link."
        />
        <Textarea name="note" label="Your note (optional)" rows={3} maxLength={2000} placeholder="Why this role caught your eye…" />
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>{pending ? "Saving capture…" : "Save capture"}</Button>
        </div>
      </form>
    </Card>
  );
}
