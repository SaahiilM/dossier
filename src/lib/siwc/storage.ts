import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { env } from "@/lib/env";

import type { AccountSummary, StoredCredential } from "./types";

const credentialsPath = () => path.join(env.DOSSIER_DATA_DIR, "siwc", "credentials.json");

let credentialsChain: Promise<unknown> = Promise.resolve();

export async function loadCredentials(): Promise<StoredCredential[]> {
  try {
    const raw = await readFile(credentialsPath(), "utf8");
    return JSON.parse(raw) as StoredCredential[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function saveCredentials(rows: StoredCredential[]): Promise<void> {
  const file = credentialsPath();
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(rows), { mode: 0o600, flag: "wx" });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
}

/** Serializes read-modify-write so concurrent refreshes cannot overwrite with stale rows. */
export async function withCredentialsStore<T>(
  run: (rows: StoredCredential[]) => Promise<{ rows: StoredCredential[]; result: T }>,
): Promise<T> {
  const job = credentialsChain.then(loadCredentials).then(async (rows) => {
    const { rows: next, result } = await run(rows);
    await saveCredentials(next);
    return result;
  });
  credentialsChain = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

/** Test hook: reset the credentials file lock between cases. */
export function resetCredentialsLockForTests(): void {
  credentialsChain = Promise.resolve();
}

export function upsertCredential(rows: StoredCredential[], next: StoredCredential): StoredCredential[] {
  return [...rows.filter((row) => row.sub !== next.sub || row.clientId !== next.clientId), next];
}

export function toAccountSummary(row: StoredCredential): AccountSummary {
  return {
    sub: row.sub,
    clientId: row.clientId,
    email: row.email,
    name: row.name,
    picture: row.picture,
    hasDirectUsage: row.scopes.includes("chatgpt.tokens.use.direct"),
  };
}
