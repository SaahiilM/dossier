"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/toast";
import { CAPTURE_TEXT_MAX } from "@/lib/captures/domain";
import { updateCaptureAction } from "../actions";

export function CaptureDetailsForm({
  id,
  initialText,
  initialCanonicalEmployerUrl,
}: {
  id: string;
  initialText: string;
  initialCanonicalEmployerUrl: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [canonicalEmployerUrl, setCanonicalEmployerUrl] = useState(initialCanonicalEmployerUrl);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(continueToPreparation: boolean) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await updateCaptureAction({ id, text, canonicalEmployerUrl });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast(continueToPreparation ? "Details saved. Opening application preparation." : "Capture details saved.");
      if (continueToPreparation) router.push(`/new?capture=${encodeURIComponent(id)}`);
      else router.refresh();
    } catch {
      setError("The capture details could not be saved. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Textarea
        label="Official posting text"
        rows={14}
        maxLength={CAPTURE_TEXT_MAX}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Paste the job title, company, responsibilities and requirements."
        hint="This is saved to your capture and passed into New application."
      />
      <Input
        label="Official employer posting link"
        type="url"
        inputMode="url"
        maxLength={2048}
        value={canonicalEmployerUrl}
        onChange={(event) => setCanonicalEmployerUrl(event.target.value)}
        placeholder="https://careers.example/jobs/…"
        hint="Optional. Dossier only fetches this if you choose Fetch in New application."
      />
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Save details"}
        </Button>
        <Button type="button" disabled={pending} onClick={() => void save(true)}>
          {pending ? "Saving…" : "Continue to application prep →"}
        </Button>
      </div>
    </form>
  );
}
