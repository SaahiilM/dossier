"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { openPendingTab, sendPendingTab } from "@/lib/claude-tab";

import {
  beginChatGptSubscriptionSignIn,
  cancelChatGptSubscriptionSignIn,
  disconnectChatGptSubscription,
  getChatGptSubscriptionSignInStatus,
  getClaudeSubscriptionStatus,
  listChatGptSubscriptionModels,
  loadSubscriptionConnection,
  type SubscriptionConnectionView,
} from "./subscription-actions";
import { SUBSCRIPTION_RUNTIME_MESSAGE } from "./subscription-messages";
import { SettingsSectionIntro } from "./settings-screen";

export type { SubscriptionConnectionView } from "./subscription-actions";

export type SubscriptionProviderTab = "chatgpt" | "claude";

export type SubscriptionProviderSectionProps = {
  /** When set, the section does not call loadSubscriptionConnection on mount. */
  initial?: SubscriptionConnectionView;
  tab?: SubscriptionProviderTab;
  onTabChange?: (tab: SubscriptionProviderTab) => void;
  chatGptModel?: string;
  claudeModel?: string;
  onChatGptModelChange?: (model: string) => void;
  onClaudeModelChange?: (model: string) => void;
  chatGptAccountSub?: string;
  onChatGptAccountSubChange?: (sub: string) => void;
  onConnectionChange?: (view: SubscriptionConnectionView) => void;
  /** On this computer in the desktop app: authorize links open in the system browser. */
  inDesktopApp?: boolean;
  /** Setup guide: one tab only, without the settings headings. */
  compact?: boolean;
};

const TABS: { value: SubscriptionProviderTab; label: string }[] = [
  { value: "chatgpt", label: "ChatGPT" },
  { value: "claude", label: "Claude Code" },
];

type ModelList = { loading: true } | { loading: false; models: string[]; problem: string | null };

/**
 * Settings → subscription AI providers (ChatGPT plan via SIWC, Claude Code CLI).
 * Does not save provider choice to the database; the parent wires that later.
 */
export function SubscriptionProviderSection({
  initial,
  tab: tabProp,
  onTabChange,
  chatGptModel = "",
  claudeModel = "",
  onChatGptModelChange,
  onClaudeModelChange,
  chatGptAccountSub = "",
  onChatGptAccountSubChange,
  onConnectionChange,
  inDesktopApp = false,
  compact = false,
}: SubscriptionProviderSectionProps) {
  const track = useTrackSave();
  const [connection, setConnection] = useState<SubscriptionConnectionView | null>(initial ?? null);
  const [tab, setTab] = useState<SubscriptionProviderTab>(tabProp ?? "chatgpt");
  const [selectedSub, setSelectedSub] = useState<string>("");
  const [modelList, setModelList] = useState<ModelList>({ loading: false, models: [], problem: null });
  const [signingIn, setSigningIn] = useState(false);
  const [disconnectSub, setDisconnectSub] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const publish = useCallback(
    (view: SubscriptionConnectionView) => {
      setConnection(view);
      onConnectionChange?.(view);
    },
    [onConnectionChange],
  );

  const chooseTab = (next: SubscriptionProviderTab) => {
    setTab(next);
    onTabChange?.(next);
  };

  useEffect(() => {
    if (tabProp !== undefined) setTab(tabProp);
  }, [tabProp]);

  useEffect(() => {
    if (initial) publish(initial);
  }, [initial, publish]);

  useEffect(() => {
    if (initial !== undefined) return;
    let current = true;
    void loadSubscriptionConnection({}).then((result) => {
      if (current && result.ok) publish(result.data);
    });
    return () => {
      current = false;
    };
  }, [initial, publish]);

  const accounts = connection?.chatGpt.accounts ?? [];
  const runtimeAvailable = connection?.chatGpt.runtimeAvailable ?? false;
  const phase = connection?.chatGpt.phase ?? "idle";
  const accountForModels = selectedSub || chatGptAccountSub || accounts[0]?.sub || "";

  useEffect(() => {
    const sub = accountForModels;
    if (!sub || !runtimeAvailable) {
      setModelList({ loading: false, models: [], problem: null });
      return;
    }
    let current = true;
    setModelList({ loading: true });
    void listChatGptSubscriptionModels({ sub }).then((result) => {
      if (!current) return;
      if (!result.ok) setModelList({ loading: false, models: [], problem: result.error });
      else setModelList({ loading: false, ...result.data });
    });
    return () => {
      current = false;
    };
  }, [accountForModels, accounts, runtimeAvailable]);

  const refreshClaude = () => {
    void getClaudeSubscriptionStatus({}).then((result) => {
      if (!result.ok || !connection) return;
      publish({ ...connection, claude: result.data });
    });
  };

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const pollSignIn = useCallback(() => {
    void getChatGptSubscriptionSignInStatus({}).then(async (result) => {
      if (!result.ok || !connection) return;
      const next: SubscriptionConnectionView = {
        ...connection,
        chatGpt: { ...connection.chatGpt, phase: result.data.phase, accounts: result.data.accounts },
      };
      publish(next);
      if (result.data.phase === "pending") return;
      stopPoll();
      setSigningIn(false);
      if (result.data.phase === "succeeded") toast("Connected to ChatGPT.");
      else if (result.data.phase === "failed" || result.data.phase === "cancelled") toast("ChatGPT sign-in didn't finish.");
    });
  }, [connection, publish]);

  useEffect(() => {
    if (phase !== "pending") return;
    pollRef.current = setInterval(() => void pollSignIn(), 1500);
    return stopPoll;
  }, [phase, pollSignIn]);

  const connectChatGpt = async () => {
    if (!runtimeAvailable || signingIn) return;
    const existing = accounts.find((row) => row.sub === selectedSub);
    const pendingTab = openPendingTab();
    setSigningIn(true);
    const result = toastResult(
      await track(
        beginChatGptSubscriptionSignIn({
          clientId: existing?.clientId,
          loginHint: existing?.email,
        }),
      ),
    );
    if (!result.ok) {
      setSigningIn(false);
      return;
    }
    sendPendingTab(pendingTab, result.data.authorizeUrl);
    publish({
      ...(connection ?? {
        chatGpt: { runtimeAvailable, phase: result.data.phase, accounts },
        claude: { installed: false, auth: "unknown" },
      }),
      chatGpt: {
        runtimeAvailable,
        phase: result.data.phase,
        accounts,
      },
    });
  };

  const cancelSignIn = async () => {
    const result = toastResult(await track(cancelChatGptSubscriptionSignIn({})));
    if (!result.ok) return;
    stopPoll();
    setSigningIn(false);
    if (connection) publish({ ...connection, chatGpt: { ...connection.chatGpt, phase: result.data.phase } });
  };

  const confirmDisconnect = async () => {
    if (!disconnectSub) return;
    const result = toastResult(await track(disconnectChatGptSubscription({ sub: disconnectSub })));
    setDisconnectSub(null);
    if (!result.ok || !connection) return;
    publish({ ...connection, chatGpt: { ...connection.chatGpt, accounts: result.data.accounts } });
    if (result.data.accounts.length === 0) setSelectedSub("");
  };

  const models = modelList.loading ? [] : [...new Set([...modelList.models, chatGptModel].filter(Boolean))];
  const claude = connection?.claude ?? { installed: false, auth: "unknown" as const };

  return (
    <>
      {!compact && (
        <SettingsSectionIntro title="Subscription providers">
          Use a ChatGPT Plus or Pro plan, or Claude Code through your existing subscription, instead of a separate API key. Dossier never sees your chat
          password; you sign in on the provider&apos;s own site or in their CLI.
        </SettingsSectionIntro>
      )}

      {!compact && (
        <SegmentedControl
          aria-label="Subscription provider"
          options={TABS}
          value={tab}
          onValueChange={(value) => chooseTab(value as SubscriptionProviderTab)}
          className="self-start"
        />
      )}

      {tab === "chatgpt" && (
        <>
          {!runtimeAvailable && (
            <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
              {SUBSCRIPTION_RUNTIME_MESSAGE}
            </p>
          )}

          <Card className="flex flex-col gap-4">
            {accounts.length > 0 ? (
              <ul className="flex flex-col gap-3" aria-label="ChatGPT accounts">
                {accounts.map((account) => (
                  <li key={`${account.sub}:${account.clientId}`} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-4 py-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-control font-medium">{account.name ?? account.email ?? "ChatGPT account"}</span>
                      {account.email && account.name && <span className="text-meta text-muted">{account.email}</span>}
                      {!account.hasDirectUsage && (
                        <span role="alert" className="text-meta text-warning">
                          This sign-in did not include direct plan usage. Connect again and allow plan usage.
                        </span>
                      )}
                    </div>
                    <Button variant="danger-outline" size="sm" onClick={() => setDisconnectSub(account.sub)}>
                      Disconnect
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                Sign in with your ChatGPT account and allow Dossier to use your plan. You stay on OpenAI&apos;s page; tokens stay on this server.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {runtimeAvailable ? (
                <>
                  {phase === "pending" ? (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => void cancelSignIn()}>
                        Cancel sign-in
                      </Button>
                      <p className="text-meta text-muted">Finish sign-in in your browser, then wait here.</p>
                    </>
                  ) : (
                    <Button variant="primary" size="sm" disabled={signingIn} onClick={() => void connectChatGpt()}>
                      {accounts.length ? "Connect another account" : "Connect ChatGPT"}
                    </Button>
                  )}
                </>
              ) : (
                <span className={buttonClassName("secondary", "sm", "opacity-60 pointer-events-none")} aria-disabled>
                  Connect ChatGPT
                </span>
              )}
              {inDesktopApp && runtimeAvailable && (
                <p className="text-meta text-muted">The authorize page opens in your browser.</p>
              )}
            </div>

            {accounts.length > 0 && (
              <>
                {accounts.length > 1 && (
                  <Select
                    label="Account for models"
                    value={selectedSub}
                    onChange={(event) => {
                      setSelectedSub(event.target.value);
                      onChatGptAccountSubChange?.(event.target.value);
                    }}
                  >
                    {accounts.map((row) => (
                      <option key={row.sub} value={row.sub}>
                        {row.email ?? row.name ?? row.sub}
                      </option>
                    ))}
                  </Select>
                )}
                <Select
                  label="Model"
                  value={chatGptModel}
                  onChange={(event) => onChatGptModelChange?.(event.target.value)}
                  disabled={modelList.loading}
                  hint={!modelList.loading ? modelList.problem ?? undefined : undefined}
                >
                  {!chatGptModel && <option value="">{modelList.loading ? "Loading models…" : "Choose a model"}</option>}
                  {models.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </>
            )}
          </Card>
        </>
      )}

      {tab === "claude" && (
        <Card className="flex flex-col gap-4">
          <p role="status" className="text-control">
            {claude.installed ? (
              <>
                Claude Code CLI is installed.
                {claude.auth === "authenticated" && (
                  <>
                    {" "}
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="size-2 rounded-full bg-success" />
                      Signed in with your subscription.
                    </span>
                  </>
                )}
                {claude.auth === "unauthenticated" && (
                  <span role="alert" className="block text-meta text-warning">
                    The CLI is not signed in with a subscription yet.
                  </span>
                )}
              </>
            ) : (
              <span role="alert" className="text-warning">
                Claude Code CLI was not found on this server. Install it on the machine that runs Dossier.
              </span>
            )}
          </p>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-pretty">
            <li>
              Install Claude Code from Anthropic if you have not already (
              <a href="https://docs.anthropic.com/en/docs/claude-code" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                documentation
              </a>
              ).
            </li>
            <li>
              In a terminal on this machine, run <code className="font-mono text-label">claude login</code> and finish sign-in there. Dossier uses that OAuth
              session; it never asks for your password.
            </li>
            <li>Choose the model name your CLI accepts below.</li>
          </ol>
          <Button variant="secondary" size="sm" onClick={() => refreshClaude()}>
            Check CLI status
          </Button>
          <Input
            label="Model"
            value={claudeModel}
            onChange={(event) => onClaudeModelChange?.(event.target.value)}
            placeholder="e.g. sonnet"
            spellCheck={false}
            autoComplete="off"
            hint="Use the same model name you pass to claude --model."
          />
        </Card>
      )}

      <ConfirmDialog
        open={disconnectSub !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnectSub(null);
        }}
        title="Disconnect ChatGPT?"
        description="Dossier will revoke refresh access for this account on the server. You can connect again later."
        confirmLabel="Disconnect"
        onConfirm={() => void confirmDisconnect()}
      />
    </>
  );
}
