"use server";

import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { ChatGptSubscriptionProvider } from "@/lib/ai/providers/chatgpt-subscription";
import { ClaudeCliProvider, findClaudeCli } from "@/lib/ai/providers/claude-cli";
import { AiError } from "@/lib/ai";
import {
  SignInCancelledError,
  beginSignIn,
  cancelSignIn,
  disconnect,
  signInResult,
  signInStatus,
  status,
} from "@/lib/siwc";
import type { AccountSummary, SignInPhase } from "@/lib/siwc/types";

import { isSubscriptionAuthRuntime, SUBSCRIPTION_RUNTIME_MESSAGE } from "./subscription-runtime";

function assertSubscriptionRuntime(): void {
  if (!isSubscriptionAuthRuntime()) throw new ActionError(SUBSCRIPTION_RUNTIME_MESSAGE);
}

async function safelyConsumeSignInResult(): Promise<void> {
  const pending = signInResult();
  if (!pending) return;
  try {
    await pending;
  } catch (error) {
    if (error instanceof SignInCancelledError) return;
    throw new ActionError("ChatGPT sign-in didn't complete. Try again.");
  }
}

export type ChatGptSubscriptionView = {
  runtimeAvailable: boolean;
  phase: SignInPhase;
  accounts: AccountSummary[];
};

export type ClaudeSubscriptionView = {
  installed: boolean;
  auth: "authenticated" | "unauthenticated" | "unknown";
};

export type SubscriptionConnectionView = {
  chatGpt: ChatGptSubscriptionView;
  claude: ClaudeSubscriptionView;
};

async function chatGptView(): Promise<ChatGptSubscriptionView> {
  const runtimeAvailable = isSubscriptionAuthRuntime();
  if (runtimeAvailable && signInStatus() === "succeeded") await safelyConsumeSignInResult();
  const rawPhase = signInStatus();
  const accounts = await status();
  const phase: SignInPhase = runtimeAvailable ? rawPhase : "idle";
  return { runtimeAvailable, phase, accounts };
}

async function claudeView(): Promise<ClaudeSubscriptionView> {
  const executable = await findClaudeCli();
  if (!executable) return { installed: false, auth: "unknown" };
  const provider = new ClaudeCliProvider({ model: null, executable });
  const auth = await provider.authStatus(AbortSignal.timeout(10_000));
  return { installed: true, auth };
}

/** Initial connection state for the subscription settings section. */
export const loadSubscriptionConnection = action(z.object({}), async () => ({
  chatGpt: await chatGptView(),
  claude: await claudeView(),
}));

/** Starts ChatGPT SIWC and returns the authorize URL for an external browser tab. */
export const beginChatGptSubscriptionSignIn = action(
  z.object({
    clientId: z.string().trim().max(200).optional(),
    loginHint: z.string().trim().max(320).optional(),
  }),
  async (options) => {
    assertSubscriptionRuntime();
    if (signInStatus() === "pending") throw new ActionError("ChatGPT sign-in is already in progress.");
    try {
      const authorizeUrl = await beginSignIn({
        clientId: options.clientId,
        loginHint: options.loginHint,
      });
      return { authorizeUrl, phase: signInStatus() };
    } catch {
      throw new ActionError("ChatGPT sign-in couldn't start. Try again.");
    }
  },
);

/** Poll sign-in progress; accounts are redacted summaries only. */
export const getChatGptSubscriptionSignInStatus = action(z.object({}), async () => {
  assertSubscriptionRuntime();
  let phase = signInStatus();
  if (phase === "succeeded") await safelyConsumeSignInResult();
  phase = signInStatus();
  const accounts = phase === "succeeded" || phase === "idle" ? await status() : [];
  return { phase, accounts };
});

export const cancelChatGptSubscriptionSignIn = action(z.object({}), async () => {
  assertSubscriptionRuntime();
  cancelSignIn();
  return { phase: signInStatus() };
});

export const disconnectChatGptSubscription = action(
  z.object({ sub: z.string().trim().min(1).max(200) }),
  async ({ sub }) => {
    assertSubscriptionRuntime();
    try {
      await disconnect(sub);
    } catch {
      throw new ActionError("Disconnecting ChatGPT didn't work. Try again.");
    }
    return { accounts: await status() };
  },
);

export const listChatGptSubscriptionModels = action(
  z.object({ sub: z.string().trim().min(1).max(200) }),
  async ({ sub }) => {
    assertSubscriptionRuntime();
    try {
      const provider = new ChatGptSubscriptionProvider("list", sub);
      const models = await provider.listModels(AbortSignal.timeout(20_000));
      return { models, problem: null as string | null };
    } catch (error) {
      if (error instanceof AiError) return { models: [] as string[], problem: error.message };
      throw new ActionError("Couldn't list ChatGPT models. Try again.");
    }
  },
);

export const getClaudeSubscriptionStatus = action(z.object({}), async () => claudeView());
