import { TOKEN_REFRESH_SKEW_MS } from "./constants";
import { hasDirectUsage, refreshAccessToken, revokeRefreshToken } from "./oauth";
import { loadCredentials, toAccountSummary, upsertCredential, withCredentialsStore } from "./storage";
import type { AccountSummary, StoredCredential } from "./types";

const refreshInFlight = new Map<string, Promise<StoredCredential>>();

function sessionKey(credential: StoredCredential): string {
  return `${credential.sub}:${credential.clientId}`;
}

function pickAccount(rows: StoredCredential[], sub?: string): StoredCredential | undefined {
  if (!sub) return rows[0];
  const matches = rows.filter((row) => row.sub === sub);
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    throw new Error("Multiple ChatGPT registrations share this account; pick one by client ID.");
  }
  return matches[0];
}

export async function listAccounts(): Promise<AccountSummary[]> {
  return (await loadCredentials()).map(toAccountSummary);
}

export async function getAccessCredential(sub?: string): Promise<StoredCredential> {
  const rows = await loadCredentials();
  const current = pickAccount(rows, sub);
  if (!current) throw new Error("Sign in with ChatGPT first");
  if (!hasDirectUsage(current.scopes)) {
    throw new Error("This ChatGPT account did not grant direct plan usage");
  }

  if (current.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS) return current;

  const key = sessionKey(current);
  let task = refreshInFlight.get(key);
  if (!task) {
    task = withCredentialsStore(async (latest) => {
      const live = latest.find((row) => row.sub === current.sub && row.clientId === current.clientId) ?? current;
      if (live.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS) return { rows: latest, result: live };
      const refreshed = await refreshAccessToken(live);
      return { rows: upsertCredential(latest, refreshed), result: refreshed };
    }).finally(() => refreshInFlight.delete(key));
    refreshInFlight.set(key, task);
  }
  return task;
}

export async function disconnectAccount(sub: string): Promise<void> {
  await withCredentialsStore(async (rows) => {
    const target = rows.find((row) => row.sub === sub);
    if (!target) return { rows, result: undefined };
    try {
      await revokeRefreshToken(target.clientId, target.refreshToken);
    } finally {
      return { rows: rows.filter((row) => row.sub !== sub), result: undefined };
    }
  });
}
