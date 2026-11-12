"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { KeyField } from "@/components/key-field";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  OPENROUTER_KEYS_URL,
  SCORER_INFO,
  TYPESAFE_KEY_URL,
  type Scorer,
  type ScoringView,
} from "@/lib/scoring/scorers";
import { WIKI } from "@/lib/setup/instructions";

import {
  listOpenRouterScoringModels,
  saveOpenRouterScoringKey,
  saveOpenRouterScoringModel,
  saveScorer,
  saveTypesafeKey,
  testJev,
  testOpenRouterScoring,
} from "../../(app)/settings/actions";
import { ChoiceCards } from "./choice-cards";
import { InstructionList } from "./instruction-list";

type Status = { state: "idle" } | { state: "checking" } | { state: "connected" } | { state: "failed"; message: string };

type ModelList = { loading: true } | { loading: false; models: string[]; problem: string | null };

const OPTIONS: readonly { value: Scorer; name: string; description: string; tag: string }[] = [
  {
    value: "AI",
    name: "Your AI",
    description: "The AI you chose scores each posting and says in its own words why it fits. Nothing more to set up.",
    tag: "Recommended",
  },
  {
    value: "JEV",
    name: "Jev by TypeSafe",
    description: "A model made for quick yes-or-no judgments. Dossier builds the score from its answers, and the reasons quote the posting's own lines.",
    tag: "Needs a TypeSafe key · in early access",
  },
  {
    value: "OPENROUTER",
    name: "OpenRouter model",
    description: "A separate OpenRouter key and model judge postings. Your writing AI stays unchanged.",
    tag: "Needs an OpenRouter key and judging model",
  },
];

const OTHER_MODEL = "__other";

/**
 * The guide's scoring step (E21-4): Score in Find jobs and the job agent use
 * your AI unless you choose Jev or OpenRouter, which come with their own setup.
 */
export function ScoringStep({ initial }: { initial: ScoringView }) {
  const router = useRouter();
  const [scorer, setScorer] = useState<Scorer>(initial.scorer);
  const [key, setKey] = useState("");
  const [openRouterModel, setOpenRouterModel] = useState(initial.openRouterModel);
  const [otherOpenRouterModel, setOtherOpenRouterModel] = useState(false);
  const [modelList, setModelList] = useState<ModelList>({ loading: false, models: [], problem: null });
  const [status, setStatus] = useState<Status>({ state: "idle" });

  const reloadOpenRouterModels = () => {
    setModelList({ loading: true });
    void listOpenRouterScoringModels({}).then((result) => {
      if (result.ok) setModelList({ loading: false, models: result.data.models, problem: result.data.problem });
      else setModelList({ loading: false, models: [], problem: result.error });
    });
  };

  useEffect(() => {
    if (scorer !== "OPENROUTER") return;
    reloadOpenRouterModels();
  }, [scorer]);

  const choose = async (next: Scorer) => {
    setScorer(next);
    setStatus({ state: "idle" });
    if (toastResult(await saveScorer({ scorer: next })).ok) router.refresh();
  };

  const checkJev = async () => {
    setStatus({ state: "checking" });
    if (key.trim() && !toastResult(await saveTypesafeKey({ change: { action: "set", value: key } })).ok) return setStatus({ state: "idle" });
    const result = toastResult(await testJev({}));
    if (!result.ok) return setStatus({ state: "idle" });
    if (!result.data.connected) return setStatus({ state: "failed", message: result.data.message });
    setKey("");
    setStatus({ state: "connected" });
    router.refresh();
  };

  const saveOpenRouterKeyField = async (change: { action: "set"; value: string } | { action: "clear" }) => {
    const ok = toastResult(await saveOpenRouterScoringKey({ change })).ok;
    if (ok) {
      reloadOpenRouterModels();
      router.refresh();
    }
    return ok;
  };

  const saveOpenRouterModel = async (model: string) => {
    setOpenRouterModel(model);
    if (toastResult(await saveOpenRouterScoringModel({ model })).ok) router.refresh();
  };

  const checkOpenRouter = async () => {
    setStatus({ state: "checking" });
    const result = toastResult(await testOpenRouterScoring({}));
    if (!result.ok) return setStatus({ state: "idle" });
    if (!result.data.connected) return setStatus({ state: "failed", message: result.data.message });
    setStatus({ state: "connected" });
    router.refresh();
  };

  const openRouterModels = modelList.loading ? [] : [...new Set([...modelList.models, openRouterModel].filter(Boolean))];
  const openRouterSelectValue = otherOpenRouterModel || !openRouterModel ? OTHER_MODEL : openRouterModel;

  return (
    <div className="flex flex-col gap-8">
      <ChoiceCards label="Score postings with" options={OPTIONS} value={scorer} onChange={(next) => void choose(next)} />
      {scorer === "JEV" && (
        <Card className="flex flex-col gap-6">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[140px_1fr]">
            <dt className="font-medium">What it costs</dt>
            <dd className="text-pretty text-muted">You pay TypeSafe for each posting it reads. It&apos;s in early access, so a new account may have to wait for a key.</dd>
            <dt className="font-medium">Your data</dt>
            <dd className="text-pretty text-muted">
              Each posting you score goes to TypeSafe with your profile, without your name, contact details or references. TypeSafe doesn&apos;t train on it. Jev
              reads English best.
            </dd>
          </dl>
          <InstructionList
            label="Setting up Jev"
            steps={[
              { text: "Sign up for TypeSafe, then open the console's keys and create one.", link: { href: TYPESAFE_KEY_URL, label: "the TypeSafe console" } },
              { text: "Copy the key and paste it below." },
            ]}
          />
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (status.state !== "checking") void checkJev();
            }}
          >
            <Input
              label="TypeSafe key"
              type="password"
              autoComplete="off"
              placeholder={initial.keyState === "set" ? "Saved · paste a new one to replace it" : "Paste it here"}
              hint="Stored encrypted on your server, and never shown again."
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <Button type="submit" className="self-start" aria-disabled={status.state === "checking" || undefined}>
              {status.state === "checking" ? "Checking…" : "Check it"}
            </Button>
          </form>
          <div role="status" className="text-sm empty:hidden">
            {status.state === "connected" && <p className="text-success">It works: Jev answered.</p>}
            {status.state === "failed" && <p className="rounded-card bg-warning-surface px-4 py-3 font-medium text-warning">{status.message}</p>}
          </div>
          <a href={`${WIKI}/Choosing-an-AI-provider#scoring-with-jev`} target="_blank" rel="noopener noreferrer" className="self-start text-meta text-muted underline underline-offset-2 hover:text-ink">
            More help on the wiki <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Card>
      )}
      {scorer === "OPENROUTER" && (
        <Card className="flex flex-col gap-6">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[140px_1fr]">
            <dt className="font-medium">What it costs</dt>
            <dd className="text-pretty text-muted">
              You buy OpenRouter credit and pay for each judging call. This key is only for scoring — not for writing resumes or letters.
            </dd>
            <dt className="font-medium">Your data</dt>
            <dd className="text-pretty text-muted">{SCORER_INFO.OPENROUTER.description}</dd>
          </dl>
          <InstructionList
            label="Setting up OpenRouter for scoring"
            steps={[
              { text: "Sign up or sign in on OpenRouter.", link: { href: "https://openrouter.ai/", label: "OpenRouter" } },
              { text: "Buy credit and create a key.", link: { href: OPENROUTER_KEYS_URL, label: "OpenRouter's keys" } },
              { text: "Paste the key below, pick a judging model, and check it." },
            ]}
          />
          <KeyField
            label="OpenRouter key for scoring"
            keyState={initial.openRouterKeyState}
            envName="DOSSIER_OPENROUTER_SCORING_KEY"
            getKey={{ href: OPENROUTER_KEYS_URL, text: "OpenRouter" }}
            onSave={saveOpenRouterKeyField}
          />
          <Select
            label="Judging model"
            value={openRouterSelectValue}
            onChange={(event) => {
              const value = event.target.value;
              if (value === OTHER_MODEL) {
                setOtherOpenRouterModel(true);
                return;
              }
              setOtherOpenRouterModel(false);
              void saveOpenRouterModel(value);
            }}
            disabled={modelList.loading}
            hint={!modelList.loading ? modelList.problem ?? undefined : undefined}
          >
            {!openRouterModel && <option value="">{modelList.loading ? "Loading models…" : "Choose a model"}</option>}
            {openRouterModels.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value={OTHER_MODEL}>Another model…</option>
          </Select>
          {otherOpenRouterModel && (
            <Input
              label="Model name"
              value={openRouterModel}
              onChange={(event) => setOpenRouterModel(event.target.value)}
              onBlur={() => {
                if (openRouterModel.trim()) void saveOpenRouterModel(openRouterModel.trim());
              }}
              spellCheck={false}
              autoComplete="off"
            />
          )}
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (status.state !== "checking") void checkOpenRouter();
            }}
          >
            <Button type="submit" className="self-start" aria-disabled={status.state === "checking" || undefined}>
              {status.state === "checking" ? "Checking…" : "Check it"}
            </Button>
          </form>
          <div role="status" className="text-sm empty:hidden">
            {status.state === "connected" && <p className="text-success">It works: OpenRouter answered.</p>}
            {status.state === "failed" && <p className="rounded-card bg-warning-surface px-4 py-3 font-medium text-warning">{status.message}</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
