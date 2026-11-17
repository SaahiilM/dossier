# Native iOS beta handoff

This is a SwiftUI iPhone/iPad app with an embedded Share Extension. It uses the mobile v1 service at an app-configurable base URL, defaulting to `https://dossier.sahmai.party`. The wire DTOs below were checked against `docs/mobile-api-v1.md` on `origin/main` after PR #8 (`b65102d`). No backend files are changed here.

## Service interface

The client appends `/api/mobile/v1` to the configured server address. Remote servers must use HTTPS; HTTP is accepted only for local development (`localhost`, `127.0.0.1`, or `::1`). Requests use JSON and authenticate only with `Authorization: Bearer <accessToken>`; the browser session cookie is not used. Responses use ISO-8601 UTC timestamps ending in `Z`. The nullable fields documented below may be JSON `null`. Errors are displayed from `{ "error": { "code": "…", "message": "…" } }`.

| Method and path | Request | Response and client behavior |
| --- | --- | --- |
| `POST /auth/login` | `{ "password": "…", "deviceName": "iPhone" }` | `{ "accessToken": "…", "expiresAt": "…Z" }`. `deviceName` is optional in the service; the app sends the device's localized model. The opaque 43-character token is kept in Keychain. |
| `POST /auth/logout` | No body; bearer token | `{ "ok": true }`. The app clears local credentials and cache even if server revocation cannot be confirmed. |
| `GET /applications?cursor=<opaque>` | Bearer token; omit cursor on first page and return `nextCursor` unchanged | `{ "items": [ApplicationSummary], "nextCursor": null|string }`. The service fixes pages at 50; the client does not send a `limit`. |
| `GET /applications/{id}` | Bearer token | `{ "application": Application }` with the detail fields below. |
| `GET /profile` | Bearer token | `{ "profile": ProfileData }`, returned from the shared `loadProfile()` service. |
| `GET /captures?cursor=<id>` | Bearer token; omit cursor on first page and return `nextCursor` unchanged | `{ "items": [Capture], "nextCursor": null|string }`. The service defaults to 50 rows per page. |
| `POST /captures` | `{ "url": "…", "text"?: "…", "note"?: "…", "clientRequestId": "<uuid>" }` | `{ "capture": Capture }`. Retries reuse the same request ID. |

`ApplicationSummary` is the server's exact list DTO: `id`, `company`, `role`, `location`, `mode`, `status`, `archived`, nullable `match` (`{ hit, total }`), nullable `score`, and `updatedAt`. `Application` is the detail DTO: `id`, `title`, `company`, `role`, `location`, `mode`, `salary`, `status`, `archived`, nullable `deadline` (`YYYY-MM-DD`), `postingUrl`, `postingText`, `language`, nullable `sentAt`, nullable `nextInterviewAt`, `createdAt`, `updatedAt`, `extracted`, and nullable `match`. Detail `match` has `items` containing `requirement`, `result` (`covered`, `partial`, or `gap`), nullable `skill`, `experienceIds`, and nullable `note`.

`Capture` has `id`, original `url`, `text`, `note`, `state`, `canonicalEmployerUrl`, `createdAt`, and `updatedAt`. The known states are `SAVED`, `NEEDS_DETAILS`, `READY`, and `FAILED`. The server defaults to 50 captures per page, orders by `updatedAt` then `id` descending, and expects the `id` from `nextCursor` unchanged (maximum 100 characters). Capture URLs are HTTP(S); the service accepts up to 2,048 URL characters, 100,000 text characters, 2,000 note characters, and a 128-character retry ID. The service uses the retry ID for idempotency and deduplicates canonical posting URLs; a remaining conflict returns HTTP 409. It does not fetch the posting URL.

The app displays server captures from all devices in the Inbox and paginates using the server's capture ID cursor. Pending local outbox rows remain in their own section. After upload, a local row leaves the pending section; its server response is inserted into the server list and reconciled by capture ID on refresh, preventing the uploaded row from appearing twice.

The app's application decoder retains a few older field-name aliases for cached data, but the network contract is the exact DTO above. Profile data is handled as flexible JSON to keep the view aligned with the shared `ProfileData` object. A data-URL photo is displayed as an image instead of rendering its encoded bytes as text.

## Native behavior and limits

- The Applications tab reads the 50-item cursor-paged list and detail route; the Profile tab reads the shared profile route. Application, profile, and server Inbox pages are cached per server and token, with a saved-time label. Refresh is user-triggered or on app foreground.
- The Inbox combines the paginated server capture list with a separately labeled device outbox. The App Group SQLite outbox persists a UUID before upload, retains it on retry, and marks failures for retry. Server conflict deduplication is handled by the shared capture service. Capture only submits the shared URL/text/note to Dossier; the client does not fetch the linked page or make automatic LinkedIn requests.
- The Share Extension accepts a shared URL or text containing an HTTP(S) URL. Its first durable write is to the shared outbox, followed by an upload attempt when a shared token is available. Pending rows retry after sign-in, app launch/foreground, and a user request. The outbox deduplicates matching URL/text/note for 24 hours.
- Calendar UI is shown only when `nextInterviewAt` is present. It asks for write-only EventKit permission on iOS 17+, then presents Apple's event editor for user review. A calendar save does not mutate Dossier.
- MessageUI compose is guarded by a real recipient and reviewed body. The current v1 Application DTO has no recipient or email-draft fields, so the composer is not reachable with the current service response. No automatic mail send or delivery claim is made.
- Status edits, profile edits, generation, document editing, and local AI are not included. LinkedIn capture URLs are stored as metadata; no authenticated LinkedIn session, scrape, or job-site submission is made.

## Project and signing

`ios/project.yml` is the committed XcodeGen source of truth. It generates `ios/Dossier.xcodeproj`, containing the native app and embedded Share Extension. Bundle IDs are `party.sahmai.dossier.ios` and `party.sahmai.dossier.ios.ShareExtension`. Both targets declare App Group `group.party.sahmai.dossier` and the shared Keychain group `$(AppIdentifierPrefix)party.sahmai.dossier.shared`.

The simulator build uses ad hoc signing with no Team ID; the signed simulator app had empty entitlements. Safari listed Dossier in its share sheet, but selecting it returned to Safari without showing the extension UI. Therefore the Share Extension's cross-process storage/token flow is not device-verified. A physical-device install/TestFlight build needs an Apple Developer Team and provisioning for both bundle IDs, the App Group, and Keychain access group. No signing credentials are committed.

The mobile session migration `20261117120000_mobile_device_sessions` must be applied to the chosen server database before auth routes work. Production migration rollout remains an operator step. The app was not used to log in to the production service during this implementation.

## Build and verification

Tools available for this project: Xcode 27.2 (build 27B52) and XcodeGen 2.44.1. Generate the project from `ios/` with:

```sh
xcodegen generate --spec project.yml
```

Build the iPhone 17 Pro simulator target with:

```sh
xcodebuild -project Dossier.xcodeproj -scheme Dossier -configuration Debug \
  -destination 'platform=iOS Simulator,id=7D7A2732-8E70-46CF-BA0A-0D9A9D72BC17' \
  -derivedDataPath /tmp/DossierDerivedData build
```

The iPad Pro 13-inch (M5) iOS 26.3 simulator build uses:

```sh
xcodebuild -project Dossier.xcodeproj -scheme Dossier -configuration Debug \
  -destination 'platform=iOS Simulator,id=08B54A1F-6E80-4AC3-BF02-80B824FB1B24' \
  -derivedDataPath /tmp/DossierDerivedData-iPad build
```

Xcode 27.2 completed both Debug simulator builds successfully. The iPhone 17 Pro iOS 26.3 simulator was opened in the T3 Device panel; the final build was installed and launched there. The sign-in screen and default server address were visually checked. Safari listed Dossier in its share sheet, but selecting it returned to Safari without presenting the extension UI. No login or production API request was made. No UI tests were authored or run; no generated build outputs or credentials are committed.
