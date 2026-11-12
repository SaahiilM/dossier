import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { env } from "@/lib/env";

const hostIdPath = () => path.join(env.DOSSIER_DATA_DIR, "siwc", "host-id");

/** Stable opaque host ID for this installation (urn:uuid:… per SIWC docs). */
export async function getOrCreateHostId(): Promise<string> {
  const file = hostIdPath();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    const existing = (await readFile(file, "utf8")).trim();
    if (existing) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const id = `urn:uuid:${randomUUID()}`;
  await writeFile(file, id, { mode: 0o600, flag: "wx" });
  return id;
}
