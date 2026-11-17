# Mobile API v1

This document is the wire contract for the first Option C native backend slice. Routes are versioned under `/api/mobile/v1`; all responses are JSON and all errors use the same envelope. The Swift client may change its server base URL by environment, but these paths and DTO fields are stable within v1.

## Common behavior

- Successful timestamps are ISO 8601 UTC strings, serialized with `Z` (for example `2026-11-17T21:15:00.000Z`). `deadline` is a calendar date and uses `YYYY-MM-DD` instead.
- Optional values are present as JSON `null`; the API does not omit a nullable DTO field. Empty collections are `[]`.
- Private responses include `Cache-Control: no-store`.
- Production login and bearer-token requests require HTTPS, either directly or as reported by the trusted reverse proxy's `X-Forwarded-Proto` header. Local development can use HTTP.
- Error responses have this shape:

  ```json
  { "error": { "code": "unauthorized", "message": "Sign in to continue." } }
  ```

- A mobile request is authenticated only by `Authorization: Bearer <accessToken>`. The browser's `dossier_session` cookie is never read as mobile authentication.
- The API does not enable cross-origin browser access. Native URLSession clients do not need CORS.

## Authentication

### `POST /api/mobile/v1/auth/login`

Request `Content-Type` must be `application/json`. The complete UTF-8 body is limited to 8,192 bytes and unknown keys are rejected.

```json
{ "password": "the Dossier password", "deviceName": "Saahil's iPhone" }
```

`deviceName` is optional, trimmed, and limited to 80 characters; omission stores `Mobile device`. `password` is required, is not trimmed, and is limited to 4,096 characters. Login uses the configured Dossier password verifier and the existing database-backed IP/global login throttle. A successful login clears the matching throttle state.

Success is HTTP `200`:

```json
{ "accessToken": "<43-character base64url token>", "expiresAt": "2026-12-17T21:15:00.000Z" }
```

The access token is 32 cryptographically random bytes encoded as unpadded base64url and expires 30 days after creation. It is returned only by login. Dossier stores only the token's SHA-256 hash, never the bearer token. Device sessions also retain a keyed fingerprint of the configured password hash so changing the Dossier password invalidates old device sessions.

### `POST /api/mobile/v1/auth/logout`

Requires a valid bearer token. The request has no body. Success is HTTP `200`:

```json
{ "ok": true }
```

Logout sets the session's `revokedAt`. Repeating a request with that token returns `401 unauthorized`.

## Applications

### `GET /api/mobile/v1/applications`

Requires a valid bearer token. Optional query parameter `cursor` is an opaque, base64url-encoded v1 continuation value, at most 512 characters. Clients must return it unchanged and must not construct or inspect it. The fixed page size is 50. Results are ordered by `updatedAt` descending and then `id` descending. Archived applications and applications awaiting review are not listed, matching the shared Applications screen.

Success is HTTP `200`:

```json
{
  "items": [
    {
      "id": "cm...",
      "company": "Northwind",
      "role": "Product designer",
      "location": "New York",
      "mode": "Hybrid",
      "status": "INTERVIEW",
      "archived": false,
      "match": { "hit": 5, "total": 7 },
      "score": 82,
      "updatedAt": "2026-11-17T21:15:00.000Z"
    }
  ],
  "nextCursor": null
}
```

`match` and `score` are nullable. `score` is the tailored resume's integer score from 0 through 100. `status` is one of `DRAFT`, `SENT`, `SCREENING`, `INTERVIEW`, `OFFER`, `ACCEPTED`, `REJECTED`, or `DECLINED`. `nextCursor` is `null` on the last page.

### `GET /api/mobile/v1/applications/{id}`

Requires a valid bearer token. `id` is limited to 128 characters. Missing applications and applications awaiting review both return `404 not_found`.

Success is HTTP `200`:

```json
{
  "application": {
    "id": "cm...",
    "title": "Product Designer",
    "company": "Northwind",
    "role": "Product designer",
    "location": "New York",
    "mode": "Hybrid",
    "salary": "",
    "status": "INTERVIEW",
    "archived": false,
    "deadline": null,
    "postingUrl": "https://jobs.example.test/123",
    "postingText": "The original posting text...",
    "language": "English",
    "sentAt": "2026-11-17T21:15:00.000Z",
    "nextInterviewAt": null,
    "createdAt": "2026-11-17T21:15:00.000Z",
    "updatedAt": "2026-11-17T21:15:00.000Z",
    "extracted": {
      "title": "Product Designer",
      "company": "Northwind",
      "role": "Product designer",
      "location": "New York",
      "mode": "Hybrid",
      "salary": null,
      "deadline": null,
      "requirements": [],
      "asksForReferences": false,
      "language": "English"
    },
    "match": null
  }
}
```

The application DTO always includes every field shown above. `deadline`, `sentAt`, and `nextInterviewAt` may be `null`; `createdAt` and `updatedAt` are always present. `postingUrl` is an HTTP(S) URL or the empty string; `postingText` is the saved original text. `extracted` is parsed through the shared extraction schema, with legacy application fields used as the fallback. `match` is `null` for absent or invalid legacy data; otherwise it has shape `{ "items": [{ "requirement": string, "result": "covered" | "partial" | "gap", "skill": string | null, "experienceIds": string[], "note": string | null }] }`.

## Profile

### `GET /api/mobile/v1/profile`

Requires a valid bearer token. Success is HTTP `200`:

```json
{ "profile": { "basics": {}, "photo": null, "skills": [], "languages": [], "experience": [], "projects": [], "education": [], "certifications": [], "publications": [], "references": [], "customSections": [], "facts": [], "workAuthorization": {} } }
```

The profile object is the exact `ProfileData` returned by the shared `loadProfile()` service. This avoids a second profile mapping contract:

- `basics`: `name`, `headline`, `email`, `phone`, `dob`, `website`, `address`, `city`, `country`, `linkedin`, and `summary` are strings; `showAge` is a boolean.
- `photo`: `null` or `{ "src": string, "onResumes": boolean }`; `src` is the existing image data URL.
- `skills`: `{ id, name, group }[]`; `languages`: `{ id, name, level }[]`, where level is `NATIVE`, `C2`, `C1`, `B2`, `B1`, `A2`, or `A1`.
- `experience`: `{ id, role, company, location, descriptor, volunteering, bullets, startYear, startMonth, endYear, endMonth, current, skillIds }[]`.
- `projects`: `{ id, name, link, bullets, startYear, startMonth, endYear, endMonth, current, skillIds }[]`.
- `education`: `{ id, degree, school, notes, startYear, startMonth, endYear, endMonth, current }[]`.
- `certifications`: `{ id, name, issuer, year, month, expiryYear, expiryMonth, credentialId, link, onResumes }[]`.
- `publications`: `{ id, citation, link, onResumes }[]`; `references`: `{ id, name, relation, company, email, phone }[]`.
- `customSections`: `{ id, title, format, items }[]`; `format` is `ENTRIES`, `LINES`, or `INLINE`. Each item is `{ id, title, subtitle, startYear, startMonth, endYear, endMonth, current, details, link, onResumes }`.
- `facts`: `{ id, text }[]`.
- `workAuthorization`: `{ authorizedCountries: string[], needsSponsorshipNow: boolean | null, needsSponsorshipLater: boolean | null, visaStatuses: { jurisdiction: string, status: string }[], relocationWillingness: boolean | null, relocationPreferredCountries: string[] }`.

Year and month fields are integers or `null`. The profile photo is the only response field that can contain a large data URL (at most 700,000 characters, as already enforced by the profile photo loader).

## Errors

| HTTP | `error.code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | Malformed JSON, invalid fields, or an invalid cursor. |
| 401 | `invalid_credentials` | The password is incorrect. |
| 401 | `unauthorized` | Missing, malformed, expired, revoked, or otherwise invalid bearer token. |
| 404 | `not_found` | Application is unavailable to this API. |
| 413 | `payload_too_large` | Request exceeds its documented byte limit. |
| 415 | `unsupported_media_type` | Login body is not JSON. |
| 429 | `rate_limited` | Existing login throttle refused the attempt; `Retry-After` is whole seconds. |
| 500 | `internal_error` | Unexpected server error; response does not include implementation details. |

Error messages are safe to display. Invalid, expired, and revoked tokens share the same response to avoid exposing session state. The server does not log passwords or bearer tokens.

## Server service boundary and reserved routes

- `GET /applications` uses `loadApplicationRows({ archived: false, sort: DEFAULT_SORT })` from `src/lib/applications-data.ts`, then applies the v1 keyset page boundary and ISO timestamp mapping.
- `GET /profile` returns `loadProfile()` from `src/lib/profile-data.ts` unchanged.
- `GET /applications/{id}` performs a narrow Prisma select in `src/lib/mobile/resources.ts` and uses the shared extraction and match schemas. The existing page loader is coupled to Next's `notFound()` boundary and loads page-only relations, so it is not suitable for a JSON API response.
- `GET /captures?cursor=<id>` returns `{ items, nextCursor }`. POST accepts `{ url, text?, note?, clientRequestId }` and returns `{ capture }`. Reuse the request ID on retries. Both use the same service as the web capture Inbox. Each capture includes `id`, `url` (original URL), `text`, `note`, `state`, `canonicalEmployerUrl`, `createdAt`, and `updatedAt`. A capture conflict returns HTTP 409 with code `conflict`. Capture performs no network fetch.

## Migration and rollout

Migration `20261117120000_mobile_device_sessions` is additive in both Prisma migration trees. It creates `MobileDeviceSession` with a unique `tokenHash` plus `expiresAt` and `revokedAt` indexes; no existing rows are changed and no backfill is needed. Apply it before serving v1:

- PostgreSQL: run `yarn prisma migrate deploy` with the PostgreSQL `DATABASE_URL`.
- SQLite: run the same command with a `file:` `DATABASE_URL`; `prisma7.config.ts` selects `prisma/sqlite/schema.prisma` and `prisma/sqlite/migrations`.

The production auto-deployer pauses deployments that change migrations for manual review. Back up the active database, review and apply this migration, then start the API version that reads `MobileDeviceSession`.
