"use client";

import Link from "next/link";
import { RadioGroup } from "radix-ui";
import { useEffect, useState } from "react";

import { KeyField } from "@/components/key-field";
import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { OPENROUTER_KEYS_URL, SCORER_INFO, SCORERS, TYPESAFE_KEY_URL, type Scorer, type ScoringView } from "@/lib/scoring/scorers";
import { cn } from "@/lib/cn";
import { useAutosave } from "@/hooks/use-autosave";

import {
  listOpenRouterScoringModels,
  saveOpenRouterScoringKey,
  saveOpenRouterScoringModel,
  saveScorer,
  saveTypesafeKey,
  testJev,
  testOpenRouterScoring,
} from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

type Connection =
  | { status: "untested" }
  | { status: "testing" }
  | { status: "connected"; model: string; seconds: number }
  | { status: "failed"; message: string };

type ModelList = { loading: true } | { loading: false; models: string[]; problem: string | null };

const OTHER_MODEL = "__other";

/**
 * Settings → Scoring (#274): whether Score in Find jobs and the job agent
 * use the AI model, Jev or OpenRouter. Each change saves on its own.
 */
export function ScoringSection({ initial }: { initial: ScoringView }) {
  const track = useTrackSave();
  const [view, setView] = useState(initial);
  const [connection, setConnection] = useState<Connection>({ status: "untested" });
  const [openRouterModel, setOpenRouterModel] = useState(initial.openRouterModel);
  const [otherOpenRouterModel, setOtherOpenRouterModel] = useState(false);
  const [modelList, setModelList] = useState<ModelList>({ loading: false, models: [], problem: null });

  const apply = (result: Awaited<ReturnType<typeof saveScorer>>) => {
    if (result.ok) setView(result.data);
    return result.ok;
  };

  const reloadOpenRouterModels = () => {
    setModelList({ loading: true });
    void listOpenRouterScoringModels({}).then((result) => {
      if (result.ok) setModelList({ loading: false, models: result.data.models, problem: result.data.problem });
      else setModelList({ loading: false, models: [], problem: result.error });
    });
  };

  useEffect(() => {
    if (view.scorer !== "OPENROUTER") return;
    reloadOpenRouterModels();
  }, [view.scorer]);

  const { flush: flushModel } = useAutosave({ model: openRouterModel }, async ({ model }) => {
    const result = await track(saveOpenRouterScoringModel({ model }));
    if (result.ok) setView(result.data);
    return result;
  });

  const choose = async (scorer: Scorer) => {
    setView((current) => ({ ...current, scorer }));
    setConnection({ status: "untested" });
    apply(toastResult(await track(saveScorer({ scorer }))));
  };

  const saveKey = async (change: { action: "set"; value: string } | { action: "clear" }) => {
    setConnection({ status: "untested" });
    return apply(toastResult(await track(saveTypesafeKey({ change }))));
  };

  const saveOpenRouterKey = async (change: { action: "set"; value: string } | { action: "clear" }) => {
    setConnection({ status: "untested" });
    const ok = apply(toastResult(await track(saveOpenRouterScoringKey({ change }))));
    if (ok) reloadOpenRouterModels();
    return ok;
  };

  const test = async () => {
    if (connection.status === "testing") return;
    setConnection({ status: "testing" });
    const result = view.scorer === "OPENROUTER" ? await testOpenRouterScoring({}) : await testJev({});
    if (!result.ok) setConnection({ status: "failed", message: result.error });
    else if (result.data.connected) setConnection({ status: "connected", model: result.data.model, seconds: result.data.seconds });
    else setConnection({ status: "failed", message: result.data.message });
  };

  const modelSelectValue = otherOpenRouterModel || !openRouterModel ? OTHER_MODEL : openRouterModel;

  return (
    <>
      <SettingsSectionIntro title="Scoring">
        How Score in Find jobs and the job agent judge how well a posting fits your profile. Drafts are always written by your AI model.
      </SettingsSectionIntro>

      <RadioGroup.Root
        aria-label="Score postings with"
        value={view.scorer}
        onValueChange={(value) => void choose(value as Scorer)}
        className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3"
      >
        {SCORERS.map((scorer) => (
          <RadioGroup.Item
            key={scorer}
            value={scorer}
            aria-label={SCORER_INFO[scorer].name}
            aria-describedby={`scorer-${scorer}`}
            className="group flex flex-col gap-1.5 rounded-card border border-line-card bg-card p-[18px] text-left hover:border-line-strong data-[state=checked]:border-primary data-[state=checked]:shadow-[0_0_0_1px_var(--color-primary)]"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-[15px] font-medium">{SCORER_INFO[scorer].name}</span>
              <span
                aria-hidden
                className="grid size-4 place-items-center rounded-full border-[1.5px] border-line-strong group-data-[state=checked]:border-primary"
              >
                <RadioGroup.Indicator className="size-2 rounded-full bg-primary" />
              </span>
            </span>
            <span id={`scorer-${scorer}`} className="flex flex-col gap-1.5">
              <span className="text-meta text-muted">{SCORER_INFO[scorer].description}</span>
              <span className="text-xs text-muted">{SCORER_INFO[scorer].tag}</span>
            </span>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>

      {view.scorer === "JEV" && (
        <>
          <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
            Each posting you score goes to TypeSafe with your profile, without your name or contact details. Jev reads English best: postings in other languages are
            judged less well.
          </p>

          <Card className="flex flex-col gap-5">
            <KeyField
              label="TypeSafe key"
              keyState={view.keyState}
              envName="DOSSIER_TYPESAFE_KEY"
              getKey={{ href: TYPESAFE_KEY_URL, text: "the TypeSafe console" }}
              onSave={saveKey}
            />
            <div className="flex flex-wrap items-center gap-3.5 pt-1">
              <Button variant="secondary" onClick={() => void test()} disabled={connection.status === "testing"}>
                {connection.status === "testing" ? "Testing…" : "Test connection"}
              </Button>
              <ConnectionStatus connection={connection} testingHint="Asking Jev one short question…" />
            </div>
          </Card>

          <p className="text-sm text-muted">
            Jev&apos;s scores and your AI model&apos;s aren&apos;t on the same scale. If the job agent queues too many postings or too few, change its minimum score in{" "}
            <Link href="/settings?section=agent" className="underline underline-offset-2 hover:text-ink">
              Settings → Job agent
            </Link>
            .
          </p>
        </>
      )}

      {view.scorer === "OPENROUTER" && (
        <>
          <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
            Judging uses its own OpenRouter key and model, separate from Settings → AI provider. Your profile goes to OpenRouter, without your name or contact details.
          </p>

          <Card className="flex flex-col gap-5">
            <KeyField
              label="OpenRouter key"
              keyState={view.openRouterKeyState}
              envName="DOSSIER_OPENROUTER_SCORING_KEY"
              getKey={{ href: OPENROUTER_KEYS_URL, text: "OpenRouter" }}
              onSave={saveOpenRouterKey}
            />
            {modelList.loading ? (
              <p className="text-meta text-muted">Loading models…</p>
            ) : modelList.problem ? (
              <Input
                label="Judging model"
                value={openRouterModel}
                placeholder="e.g. anthropic/claude-sonnet-4"
                hint={modelList.problem}
                onChange={(event) => {
                  setOpenRouterModel(event.target.value);
                  setConnection({ status: "untested" });
                }}
                onBlur={() => void flushModel()}
              />
            ) : (
              <Select
                label="Judging model"
                value={modelSelectValue}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === OTHER_MODEL) {
                    setOtherOpenRouterModel(true);
                    return;
                  }
                  setOtherOpenRouterModel(false);
                  setOpenRouterModel(value);
                  setConnection({ status: "untested" });
                  void saveOpenRouterScoringModel({ model: value }).then((result) => {
                    if (result.ok) setView(result.data);
                  });
                }}
              >
                {!openRouterModel && !otherOpenRouterModel && <option value="">Choose a model</option>}
                {modelList.models.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
                <option value={OTHER_MODEL}>Other…</option>
              </Select>
            )}
            {otherOpenRouterModel && !modelList.loading && !modelList.problem && (
              <Input
                label="Model id"
                value={openRouterModel}
                placeholder="Type the model's id on OpenRouter"
                onChange={(event) => {
                  setOpenRouterModel(event.target.value);
                  setConnection({ status: "untested" });
                }}
                onBlur={() => void flushModel()}
              />
            )}
            <div className="flex flex-wrap items-center gap-3.5 pt-1">
              <Button variant="secondary" onClick={() => void test()} disabled={connection.status === "testing"}>
                {connection.status === "testing" ? "Testing…" : "Test connection"}
              </Button>
              <ConnectionStatus connection={connection} testingHint="Asking the judging model one short question…" />
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function ConnectionStatus({ connection, testingHint }: { connection: Connection; testingHint: string }) {
  const [dot, text, message] =
    connection.status === "connected"
      ? ["bg-success", "text-success", `Connected · ${connection.model} answered in ${connection.seconds.toLocaleString("en-US")} s`]
      : connection.status === "failed"
        ? ["bg-error", "text-error", connection.message]
        : connection.status === "testing"
          ? ["bg-status-offer", "text-muted", testingHint]
          : ["bg-faint", "text-muted", "Not tested since your last change · a test costs a few dozen tokens"];
  return (
    <p role="status" className={cn("flex items-center gap-2 text-control", text)}>
      <span aria-hidden className={cn("size-2 flex-none rounded-full", dot)} />
      {message}
    </p>
  );
}
