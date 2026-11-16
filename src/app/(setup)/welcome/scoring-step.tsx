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
  OPENROUTER_DECISION_MODEL,
  OPENROUTER_KEYS_URL,
  SCORER_INFO,
  TYPESAFE_KEY_URL,
  type Scorer,
  type ScoringView,
} from "@/lib/scoring/scorers";
import { WIKI } from "@/lib/setup/instructions";

import {
  listOpenRouterDecisionModels,
  listOpenRouterScoringModels,
  saveOpenRouterScoringKey,
  saveOpenRouterScoringModel,
  saveScorer,
  saveTypesafeKey,
  testJev,
  testOpenRouterDecisions,
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
    value: "OPENROUTER_DECISIONS",
    name: "OpenRouter decision model",
    description: "A free decision model answers the same questions as Jev. Dossier builds the score from those answers and quotes the posting. It writes no prose.",
    tag: `Default ${OPENROUTER_DECISION_MODEL}`,
  },
  {
    value: "OPENROUTER",
    name: "OpenRouter chat model",
    description: "A separate OpenRouter key and chat model judge postings and write the explanation. Your writing AI stays unchanged.",
    tag: "Needs an OpenRouter key and a chat model",
  },
];

const OTHER_MODEL = "__other";

/**
 * The guide's scoring step (E21-4): Score in Find jobs and the job agent use
 * your AI unless you choose Jev or an OpenRouter scorer, which come with their own setup.
 */
export function ScoringStep({ initial }: { initial: ScoringView }) {
  const router = useRouter();
  const [scorer, setScorer] = useState<Scorer>(initial.scorer);
  const [key, setKey] = useState("");
  const [openRouterModel, setOpenRouterModel] = useState(initial.openRouterModel);
  const [otherOpenRouterModel, setOtherOpenRouterModel] = useState(false);
  const [modelList, setModelList] = useState<ModelList>(
    initial.scorer === "OPENROUTER" || initial.scorer === "OPENROUTER_DECISIONS" ? { loading: true } : { loading: false, models: [], problem: null },
  );
  const [status, setStatus] = useState<Status>({ state: "idle" });

  const reloadOpenRouterModels = (next: Scorer = scorer) => {
    if (next !== "OPENROUTER" && next !== "OPENROUTER_DECISIONS") return;
    setModelList({ loading: true });
    const list = next === "OPENROUTER_DECISIONS" ? listOpenRouterDecisionModels({}) : listOpenRouterScoringModels({});
    void list.then((result) => {
      if (result.ok) setModelList({ loading: false, models: result.data.models, problem: result.data.problem });
      else setModelList({ loading: false, models: [], problem: result.error });
    });
  };

  useEffect(() => {
    if (scorer !== "OPENROUTER" && scorer !== "OPENROUTER_DECISIONS") return;
    let cancel = false;
    const list = scorer === "OPENROUTER_DECISIONS" ? listOpenRouterDecisionModels({}) : listOpenRouterScoringModels({});
    void list.then((result) => {
      if (cancel) return;
      if (result.ok) setModelList({ loading: false, models: result.data.models, problem: result.data.problem });
      else setModelList({ loading: false, models: [], problem: result.error });
    });
    return () => {
      cancel = true;
    };
  }, [scorer]);

  const choose = async (next: Scorer) => {
    setScorer(next);
    setStatus({ state: "idle" });
    if (next === "OPENROUTER" || next === "OPENROUTER_DECISIONS") setModelList({ loading: true });
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

  const checkOpenRouter = async (decisions: boolean) => {
    setStatus({ state: "checking" });
    const result = toastResult(await (decisions ? testOpenRouterDecisions({}) : testOpenRouterScoring({})));
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
      {scorer === "OPENROUTER_DECISIONS" && (
        <Card className="flex flex-col gap-6">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[140px_1fr]">
            <dt className="font-medium">What it costs</dt>
            <dd className="text-pretty text-muted">
              The default model is free. This key is only for scoring. A paid decision model is refused.
            </dd>
            <dt className="font-medium">Your data</dt>
            <dd className="text-pretty text-muted">{SCORER_INFO.OPENROUTER_DECISIONS.description}</dd>
          </dl>
          <InstructionList
            label="Setting up the OpenRouter decision model"
            steps={[
              { text: "Sign up or sign in on OpenRouter.", link: { href: "https://openrouter.ai/", label: "OpenRouter" } },
              { text: "Create a key. Credit is not required for the free decision model.", link: { href: OPENROUTER_KEYS_URL, label: "OpenRouter's keys" } },
              { text: "Paste the key below, keep the default model, and check it." },
            ]}
          />
          <KeyField
            label="OpenRouter key for scoring"
            keyState={initial.openRouterKeyState}
            envName={initial.openRouterKeyEnv ?? "DOSSIER_OPENROUTER_SCORING_KEY"}
            getKey={{ href: OPENROUTER_KEYS_URL, text: "OpenRouter" }}
            onSave={saveOpenRouterKeyField}
          />
          <Select
            label="Decision model"
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
            hint={!modelList.loading ? modelList.problem ?? `Default ${OPENROUTER_DECISION_MODEL}. A paid model is refused.` : undefined}
          >
            {!openRouterModel && <option value="">{modelList.loading ? "Loading models…" : "Choose a decision model"}</option>}
            {openRouterModels.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value={OTHER_MODEL}>Another free model…</option>
          </Select>
          {otherOpenRouterModel && (
            <Input
              label="Model name"
              value={openRouterModel}
              placeholder={OPENROUTER_DECISION_MODEL}
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
              if (status.state !== "checking") void checkOpenRouter(true);
            }}
          >
            <Button type="submit" className="self-start" aria-disabled={status.state === "checking" || undefined}>
              {status.state === "checking" ? "Checking…" : "Check it"}
            </Button>
          </form>
          <div role="status" className="text-sm empty:hidden">
            {status.state === "connected" && <p className="text-success">It works: the decision model answered.</p>}
            {status.state === "failed" && <p className="rounded-card bg-warning-surface px-4 py-3 font-medium text-warning">{status.message}</p>}
          </div>
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
            envName={initial.openRouterKeyEnv ?? "DOSSIER_OPENROUTER_SCORING_KEY"}
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
              if (status.state !== "checking") void checkOpenRouter(false);
            }}
          >
            <Button type="submit" className="self-start" aria-disabled={status.state === "checking" || undefined}>
              {status.state === "checking" ? "Checking…" : "Check it"}
            </Button>
          </form>
          <div role="status" className="text-sm empty:hidden">
            {status.state === "connected" && <p className="text-success">It works: the chat model answered.</p>}
            {status.state === "failed" && <p className="rounded-card bg-warning-surface px-4 py-3 font-medium text-warning">{status.message}</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
