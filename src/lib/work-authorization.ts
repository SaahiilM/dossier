import { z } from "zod";

/** Unspecified (not answered), explicit no, or yes — for sponsorship and relocation questions. */
export type TriState = boolean | null;

export type VisaStatusEntry = {
  jurisdiction: string;
  status: string;
};

export type WorkAuthorization = {
  /** Countries or regions where the user says they may work legally; free text, user-entered. */
  authorizedCountries: string[];
  needsSponsorshipNow: TriState;
  needsSponsorshipLater: TriState;
  /** Optional label per jurisdiction, e.g. "Indefinite leave to remain"; not document IDs. */
  visaStatuses: VisaStatusEntry[];
  relocationWillingness: TriState;
  /** When willing to relocate, countries or regions they prefer; free text. */
  relocationPreferredCountries: string[];
};

export const WORK_AUTH_FIELD_KEYS = {
  authorizedCountries: "workAuthAuthorizedCountries",
  needsSponsorshipNow: "needsSponsorshipNow",
  needsSponsorshipLater: "needsSponsorshipLater",
  visaStatuses: "visaStatuses",
  relocationWillingness: "relocationWillingness",
  relocationPreferredCountries: "relocationPreferredCountries",
} as const;

export type WorkAuthFieldKey = (typeof WORK_AUTH_FIELD_KEYS)[keyof typeof WORK_AUTH_FIELD_KEYS];

export const WORK_AUTH_PROFILE_KEYS: readonly WorkAuthFieldKey[] = Object.values(WORK_AUTH_FIELD_KEYS);

const countryList = z.array(z.string().trim().min(1).max(120)).max(50);
const visaStatusSchema = z.object({
  jurisdiction: z.string().trim().max(120).default(""),
  status: z.string().trim().max(500).default(""),
});
const visaList = z.array(visaStatusSchema).max(30);

export const workAuthorizationSchema = z.object({
  authorizedCountries: countryList.default([]),
  needsSponsorshipNow: z.union([z.literal(true), z.literal(false), z.null()]).default(null),
  needsSponsorshipLater: z.union([z.literal(true), z.literal(false), z.null()]).default(null),
  visaStatuses: visaList.default([]),
  relocationWillingness: z.union([z.literal(true), z.literal(false), z.null()]).default(null),
  relocationPreferredCountries: countryList.default([]),
});

export function emptyWorkAuthorization(): WorkAuthorization {
  return {
    authorizedCountries: [],
    needsSponsorshipNow: null,
    needsSponsorshipLater: null,
    visaStatuses: [],
    relocationWillingness: null,
    relocationPreferredCountries: [],
  };
}

const triStateFromField = (value: string | undefined): TriState => {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
};

const triStateToField = (value: TriState): string | null => {
  if (value === true) return "yes";
  if (value === false) return "no";
  return null;
};

const parseJsonList = <T>(raw: string | undefined, schema: z.ZodType<T>): T | null => {
  if (raw === undefined || raw === "") return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** Reads work authorization from ProfileField rows; missing keys mean unknown or empty. */
export function workAuthorizationFromFields(rows: readonly { key: string; value: string }[]): WorkAuthorization {
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const defaults = emptyWorkAuthorization();
  const authorizedCountries =
    parseJsonList(values.get(WORK_AUTH_FIELD_KEYS.authorizedCountries), countryList) ?? defaults.authorizedCountries;
  const visaStatuses = parseJsonList(values.get(WORK_AUTH_FIELD_KEYS.visaStatuses), visaList) ?? defaults.visaStatuses;
  const relocationPreferredCountries =
    parseJsonList(values.get(WORK_AUTH_FIELD_KEYS.relocationPreferredCountries), countryList) ??
    defaults.relocationPreferredCountries;
  return {
    authorizedCountries,
    needsSponsorshipNow: triStateFromField(values.get(WORK_AUTH_FIELD_KEYS.needsSponsorshipNow)),
    needsSponsorshipLater: triStateFromField(values.get(WORK_AUTH_FIELD_KEYS.needsSponsorshipLater)),
    visaStatuses,
    relocationWillingness: triStateFromField(values.get(WORK_AUTH_FIELD_KEYS.relocationWillingness)),
    relocationPreferredCountries,
  };
}

/** Values to upsert or remove in ProfileField; null removes the row. */
export function fieldsFromWorkAuthorization(wa: WorkAuthorization): Record<WorkAuthFieldKey, string | null> {
  const jsonOrNull = (value: unknown, empty: boolean) => (empty ? null : JSON.stringify(value));
  return {
    [WORK_AUTH_FIELD_KEYS.authorizedCountries]: jsonOrNull(
      wa.authorizedCountries,
      wa.authorizedCountries.length === 0,
    ),
    [WORK_AUTH_FIELD_KEYS.needsSponsorshipNow]: triStateToField(wa.needsSponsorshipNow),
    [WORK_AUTH_FIELD_KEYS.needsSponsorshipLater]: triStateToField(wa.needsSponsorshipLater),
    [WORK_AUTH_FIELD_KEYS.visaStatuses]: jsonOrNull(
      wa.visaStatuses,
      wa.visaStatuses.every((entry) => !entry.jurisdiction.trim() && !entry.status.trim()),
    ),
    [WORK_AUTH_FIELD_KEYS.relocationWillingness]: triStateToField(wa.relocationWillingness),
    [WORK_AUTH_FIELD_KEYS.relocationPreferredCountries]: jsonOrNull(
      wa.relocationPreferredCountries,
      wa.relocationPreferredCountries.length === 0,
    ),
  };
}

/** How many facets the user has filled in (for the section nav count). */
export function workAuthorizationFilled(wa: WorkAuthorization): number {
  let count = wa.authorizedCountries.length > 0 ? 1 : 0;
  count += wa.visaStatuses.filter((entry) => entry.jurisdiction.trim() || entry.status.trim()).length;
  if (wa.needsSponsorshipNow !== null) count += 1;
  if (wa.needsSponsorshipLater !== null) count += 1;
  if (wa.relocationWillingness !== null) count += 1;
  if (wa.relocationPreferredCountries.length > 0) count += 1;
  return count;
}

/**
 * Scorer / AI integration contract: structured facts the user entered only.
 * Omitted when everything is empty or unknown. The scorer worker can merge this
 * into prompts; resumes and cover letters do not include it automatically.
 */
export function workAuthorizationForScorer(wa: WorkAuthorization): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (wa.authorizedCountries.length > 0) out.authorizedCountries = [...wa.authorizedCountries];
  if (wa.needsSponsorshipNow !== null) out.needsSponsorshipNow = wa.needsSponsorshipNow;
  if (wa.needsSponsorshipLater !== null) out.needsSponsorshipLater = wa.needsSponsorshipLater;
  const visas = wa.visaStatuses
    .map((entry) => ({
      jurisdiction: entry.jurisdiction.trim(),
      status: entry.status.trim(),
    }))
    .filter((entry) => entry.jurisdiction || entry.status);
  if (visas.length > 0) out.visaStatuses = visas;
  if (wa.relocationWillingness !== null) out.relocationWillingness = wa.relocationWillingness;
  if (wa.relocationPreferredCountries.length > 0) out.relocationPreferredCountries = [...wa.relocationPreferredCountries];
  return Object.keys(out).length > 0 ? out : null;
}
