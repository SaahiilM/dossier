import "server-only";

import { isDesktopApp } from "@/lib/desktop";
import { env } from "@/lib/env";

function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

/**
 * ChatGPT SIWC needs a loopback OAuth callback on the machine that runs Dossier.
 * The desktop app qualifies; so does an install you reach only through localhost.
 */
export function isSubscriptionAuthRuntime(): boolean {
  if (isDesktopApp()) return true;
  if (process.env.DOSSIER_SUBSCRIPTION_LOOPBACK === "1") return true;
  if (env.DOSSIER_PUBLIC_URL && isLoopbackUrl(env.DOSSIER_PUBLIC_URL)) return true;
  return false;
}

export { SUBSCRIPTION_RUNTIME_MESSAGE } from "./subscription-messages";
