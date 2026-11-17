import { z } from "zod";

export const CAPTURE_INGESTION_STATES = ["SAVED", "NEEDS_DETAILS", "READY", "FAILED"] as const;
export type CaptureIngestionState = (typeof CAPTURE_INGESTION_STATES)[number];

export const CAPTURE_SOURCES = ["WEB", "IOS_SHARE"] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

export const CAPTURE_TEXT_MAX = 100_000;
export const CAPTURE_NOTE_MAX = 2_000;
export const CAPTURE_URL_MAX = 2_048;
export const CAPTURE_REQUEST_ID_MAX = 128;

const validWebUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
};

/** Employer URLs are public job pages, never LinkedIn pages that could imply logged-in resolution. */
function isLinkedInCaptureUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return hostname === "linkedin.com" || hostname.endsWith(".linkedin.com");
  } catch {
    return false;
  }
}

const captureUrlSchema = z
  .string()
  .trim()
  .min(1, "Add the link you shared.")
  .max(CAPTURE_URL_MAX, `Links must be ${CAPTURE_URL_MAX} characters or fewer.`)
  .refine(validWebUrl, "Use an http or https link without a username or password.");

const optionalWebUrlSchema = z
  .string()
  .trim()
  .max(CAPTURE_URL_MAX, `Links must be ${CAPTURE_URL_MAX} characters or fewer.`)
  .refine((value) => value === "" || (validWebUrl(value) && !isLinkedInCaptureUrl(value)), "Use a public employer link on http or https, not a LinkedIn link.")
  .default("");

export const createCaptureInputSchema = z.object({
  url: captureUrlSchema,
  canonicalEmployerUrl: optionalWebUrlSchema,
  text: z.string().trim().max(CAPTURE_TEXT_MAX, `Posting text must be ${CAPTURE_TEXT_MAX} characters or fewer.`).default(""),
  note: z.string().trim().max(CAPTURE_NOTE_MAX, `Notes must be ${CAPTURE_NOTE_MAX} characters or fewer.`).default(""),
  source: z.enum(CAPTURE_SOURCES).default("WEB"),
  clientRequestId: z
    .string()
    .trim()
    .min(1, "A request ID is required for safe retries.")
    .max(CAPTURE_REQUEST_ID_MAX, `Request IDs must be ${CAPTURE_REQUEST_ID_MAX} characters or fewer.`)
    .regex(/^[A-Za-z0-9._:-]+$/, "Use letters, numbers, dots, underscores, colons or hyphens in the request ID."),
});

export const updateCaptureInputSchema = z
  .object({
    text: z.string().trim().max(CAPTURE_TEXT_MAX, `Posting text must be ${CAPTURE_TEXT_MAX} characters or fewer.`).optional(),
    canonicalEmployerUrl: optionalWebUrlSchema.optional(),
  })
  .refine((input) => input.text !== undefined || input.canonicalEmployerUrl !== undefined, "Add posting text or an official employer link to update.");

export const captureListOptionsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(100).optional(),
});

/** Normalize a valid URL for display and for the explicitly user-supplied employer link. */
export function normalizeCaptureUrl(value: string): string {
  const url = new URL(value.trim());
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Use an http or https link without a username or password.");
  }
  url.hash = "";
  return url.toString();
}

const TRACKING_PARAMETER = /^(utm_.*|trackingid|refid|ref|src|source|from|gh_src|lever-source|trk|trkinfo|sid|campaign|cmp|mc_cid|mc_eid|fbclid|gclid|msclkid|originalsubdomain)$/i;

/** Stable, protocol-independent key for deduping tracking variants without altering originalUrl. */
export function canonicalCaptureUrl(value: string): string {
  const url = new URL(value.trim());
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Use an http or https link without a username or password.");
  }
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const host = `${hostname}${url.port ? `:${url.port}` : ""}`;
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const query = [...url.searchParams]
    .filter(([name]) => !TRACKING_PARAMETER.test(name))
    .sort(([nameA, valueA], [nameB, valueB]) => nameA.localeCompare(nameB) || valueA.localeCompare(valueB));
  const search = new URLSearchParams(query).toString();
  return `${host}${pathname}${search ? `?${search}` : ""}`;
}

/** LinkedIn shares need user-provided posting text or an official employer link. */
export { isLinkedInCaptureUrl };

export function captureIngestionState(input: { originalUrl: string; text: string; canonicalEmployerUrl: string }): CaptureIngestionState {
  if (input.text.trim() || input.canonicalEmployerUrl) return "READY";
  return isLinkedInCaptureUrl(input.originalUrl) ? "NEEDS_DETAILS" : "SAVED";
}

export const CAPTURE_STATE_LABELS: Record<CaptureIngestionState, string> = {
  SAVED: "Saved",
  NEEDS_DETAILS: "Needs details",
  READY: "Ready for prep",
  FAILED: "Could not process",
};

export const captureIngestionStateSchema = z.enum(CAPTURE_INGESTION_STATES);
export const captureSourceSchema = z.enum(CAPTURE_SOURCES);

export type CreateCaptureInput = z.input<typeof createCaptureInputSchema>;
export type ParsedCreateCaptureInput = z.output<typeof createCaptureInputSchema>;
export type UpdateCaptureInput = z.output<typeof updateCaptureInputSchema>;
