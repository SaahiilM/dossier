# Profile work authorization fields

Work authorization lives in the **Work authorization** profile section. Values are stored as `ProfileField` rows (see `src/lib/work-authorization.ts`). No separate database table is required.

## Fields

| Field | Type | Storage |
| --- | --- | --- |
| `authorizedCountries` | string[] | JSON in `workAuthAuthorizedCountries` |
| `needsSponsorshipNow` | `true` \| `false` \| `null` (unknown) | `needsSponsorshipNow`: `yes` / `no` / absent |
| `needsSponsorshipLater` | tri-state | `needsSponsorshipLater` |
| `visaStatuses` | `{ jurisdiction, status }[]` | JSON in `visaStatuses` |
| `relocationWillingness` | tri-state | `relocationWillingness` |
| `relocationPreferredCountries` | string[] | JSON in `relocationPreferredCountries` |

`null` tri-state means the user did not answer. That is not the same as explicit `false`.

## Scorer worker integration

Import `workAuthorizationForScorer` from `@/lib/work-authorization` (re-exported from `@/lib/profile`). It returns a plain object for prompts, or `null` when everything is empty or unknown. Wire it in the scorer / `profileForPrompt` path in a separate change — resumes and cover letters must not include these fields automatically.

## Export / import

Export schema version **12** documents the new keys in `profile.fields`. Older exports import with defaults from `emptyWorkAuthorization()`.
