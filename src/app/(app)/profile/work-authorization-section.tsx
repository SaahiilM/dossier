"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RemovableChip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useAutosave } from "@/hooks/use-autosave";
import type { ProfileData, TriState, VisaStatusEntry, WorkAuthorization } from "@/lib/profile";

import { saveWorkAuthorization } from "./actions";
import { useTrackSave } from "@/components/save-tracker";
import type { UpdateProfile } from "./skills-section";

type TriChoice = "unknown" | "no" | "yes";

const TRI_OPTIONS: { value: TriChoice; label: string }[] = [
  { value: "unknown", label: "Not set" },
  { value: "no", label: "No" },
  { value: "yes", label: "Yes" },
];

const triToChoice = (value: TriState): TriChoice => (value === null ? "unknown" : value ? "yes" : "no");
const choiceToTri = (choice: TriChoice): TriState => (choice === "unknown" ? null : choice === "yes");

function TriStateField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: TriState;
  onChange: (value: TriState) => void;
}) {
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <span className="text-sm font-medium">{label}</span>
      <SegmentedControl
        aria-label={label}
        options={TRI_OPTIONS}
        value={triToChoice(value)}
        onValueChange={(choice) => onChange(choiceToTri(choice as TriChoice))}
        size="sm"
      />
      {hint && <p className="text-label text-muted">{hint}</p>}
    </div>
  );
}

function CountryChips({
  label,
  hint,
  countries,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: string;
  countries: string[];
  placeholder: string;
  onChange: (countries: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const name = draft.trim();
    if (!name || countries.some((entry) => entry.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
      setDraft("");
      return;
    }
    onChange([...countries, name]);
    setDraft("");
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Input
        label={label}
        hint={hint}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKey}
        onBlur={add}
      />
      {countries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {countries.map((country) => (
            <RemovableChip key={country} removeLabel={`Remove ${country}`} onRemove={() => onChange(countries.filter((entry) => entry !== country))}>
              {country}
            </RemovableChip>
          ))}
        </div>
      )}
    </div>
  );
}

function VisaRow({
  entry,
  onChange,
  onRemove,
}: {
  entry: VisaStatusEntry;
  onChange: (entry: VisaStatusEntry) => void;
  onRemove: () => void;
}) {
  const jurisdictionId = useId();
  const statusId = useId();
  return (
    <Card className="grid grid-cols-2 gap-[18px] p-5">
      <Input
        id={jurisdictionId}
        label="Country or region"
        placeholder="Germany"
        value={entry.jurisdiction}
        onChange={(event) => onChange({ ...entry, jurisdiction: event.target.value })}
      />
      <Input
        id={statusId}
        label="Your label (optional)"
        hint="A short note for you and the scorer only. It does not prove work rights."
        placeholder="e.g. permanent resident"
        value={entry.status}
        onChange={(event) => onChange({ ...entry, status: event.target.value })}
      />
      <Button type="button" variant="text" className="col-span-2 w-fit" onClick={onRemove}>
        Remove
      </Button>
    </Card>
  );
}

/**
 * Work authorization and relocation: user-entered facts for scoring and AI,
 * not copied onto resumes automatically.
 */
export function WorkAuthorizationSection({
  profile,
  update,
}: {
  profile: ProfileData;
  update: UpdateProfile;
}) {
  const track = useTrackSave();
  const [wa, setWa] = useState(profile.workAuthorization);
  useEffect(() => setWa(profile.workAuthorization), [profile.workAuthorization]);
  const { flush } = useAutosave(wa, (value) => track(saveWorkAuthorization(value)));
  const patch = (change: (current: WorkAuthorization) => WorkAuthorization) => {
    const next = change(wa);
    setWa(next);
    update((current) => ({ ...current, workAuthorization: next }));
  };
  const touch = () => queueMicrotask(() => flush());

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-5 px-7 py-6">
        <p className="text-meta text-muted">
          What you enter here is for job matching and the AI only. It does not go on resumes or cover letters unless you
          put it somewhere else. Do not enter passport or visa document numbers.
        </p>
        <CountryChips
          label="Where you can work"
          hint="Countries or regions where you say you may work legally. Press Enter to add each one."
          placeholder="Canada"
          countries={wa.authorizedCountries}
          onChange={(authorizedCountries) => {
            patch((current) => ({ ...current, authorizedCountries }));
            touch();
          }}
        />
      </Card>

      <Card className="flex flex-col gap-5 px-7 py-6">
        <h3 className="text-lead font-medium">Sponsorship</h3>
        <TriStateField
          label="Do you need visa sponsorship for your next role?"
          hint="'Not set' means you have not answered; 'No' is an explicit no."
          value={wa.needsSponsorshipNow}
          onChange={(needsSponsorshipNow) => {
            patch((current) => ({ ...current, needsSponsorshipNow }));
            touch();
          }}
        />
        <TriStateField
          label="Might you need sponsorship later?"
          value={wa.needsSponsorshipLater}
          onChange={(needsSponsorshipLater) => {
            patch((current) => ({ ...current, needsSponsorshipLater }));
            touch();
          }}
        />
      </Card>

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-lead font-medium">Immigration status by place</h3>
          <span className="text-meta text-muted">{wa.visaStatuses.length} added</span>
        </div>
        {wa.visaStatuses.map((entry, index) => (
          <VisaRow
            key={index}
            entry={entry}
            onChange={(next) => {
              patch((current) => ({
                ...current,
                visaStatuses: current.visaStatuses.map((item, i) => (i === index ? next : item)),
              }));
              touch();
            }}
            onRemove={() => {
              patch((current) => ({ ...current, visaStatuses: current.visaStatuses.filter((_, i) => i !== index) }));
              touch();
            }}
          />
        ))}
        <Button
          type="button"
          variant="secondary"
          className="w-fit"
          onClick={() => {
            patch((current) => ({ ...current, visaStatuses: [...current.visaStatuses, { jurisdiction: "", status: "" }] }));
            touch();
          }}
        >
          + Add a status
        </Button>
      </div>

      <Card className="flex flex-col gap-5 px-7 py-6">
        <h3 className="text-lead font-medium">Relocation</h3>
        <TriStateField
          label="Are you open to relocating for a role?"
          value={wa.relocationWillingness}
          onChange={(relocationWillingness) => {
            patch((current) => ({ ...current, relocationWillingness }));
            touch();
          }}
        />
        {(wa.relocationWillingness === true || wa.relocationPreferredCountries.length > 0) && (
          <CountryChips
            label="Preferred countries or regions"
            placeholder="Netherlands"
            countries={wa.relocationPreferredCountries}
            onChange={(relocationPreferredCountries) => {
              patch((current) => ({ ...current, relocationPreferredCountries }));
              touch();
            }}
          />
        )}
      </Card>
    </div>
  );
}
