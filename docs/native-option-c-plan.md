# Option C: native iOS and web with shared application services

Status: proposed implementation backlog, revisited 17 November 2026. No native project or complete mobile API has been implemented. Existing job status/event routes can be reused after their authentication and response contracts are audited.

## Decision and scope

Build a real SwiftUI application. Keep the web UI in Next.js. Both clients use the same server-owned profile facts, application records, generation pipeline, document versions and tracking rules. The phone owns presentation, cached reading, recoverable drafts and an upload outbox. It is not a second authoritative database.

The existing Linux Docker deployment behind Cloudflare Tunnel remains the initial server. No Vercel migration, new microservices or database replacement is required for the first release. Infrastructure changes should follow measured needs. The existing PostgreSQL option remains available for a future deployment change.

V1 includes capture, review, profile editing, application tracking, server generation and document access. It does not promise automatic submission to arbitrary employer websites, LinkedIn account automation, a fully offline replica or local AI generation. Saving, preparing, approving, sending and confirming submission are distinct actions.

## Ownership and reuse

| Responsibility | Owner |
| --- | --- |
| Authoritative profile, application states and history | Shared server services |
| Extraction, matching, prompts, fact checks, provider access | Shared server services |
| Document versions and canonical PDF output | Shared server services |
| Scheduled searches and connected integrations | Server |
| Screen layout, navigation, accessibility, form feedback | Each client |
| Cached records, unsent edits, pending shared links | iOS client |
| Authentication and permission enforcement | Server; credentials in iOS Keychain |

Start by inspecting `src/lib/jobs/runner.ts`, `src/lib/ai/`, `src/lib/ai/fact-guard.ts`, `src/lib/posting-fetch.ts`, `src/lib/profile-data.ts`, `src/lib/auth/`, `src/app/(app)/new/actions.ts` and the existing application/document actions. These are entry points for investigation, not a claim that every required service already exists.

Baseline completed: fork PR #2 merged as `425235f`, then PR #1 merged into fork main as `833d37f`. Worker validation: 1,033 Node tests passed, 32 skipped, production build passed. GitHub reported no checks or reviews on either PR. The baseline is now deployed: fork main `5365df6`, Dossier 1.14.0. ChatGPT sign-in is repaired and connected. A Linux timer checks fork main every two minutes and deploys eligible commits with build identity and health checks; changed migrations stop for manual review.

## Immediate implementation milestone: capture on phone, continue anywhere

Keep the 16-task backlog, but implement a small vertical slice first rather than completing every resource API before a usable phone build exists.

1. Specify and implement device authentication and the minimal capture/application-list API; reuse existing server services and job routes where suitable (subsets of C02, C03, C05, C06).
2. Create the SwiftUI shell, sign-in, applications list and detail; audit signing and real-device installation early (C04 and read-only C12).
3. Add durable capture records, retry-safe IDs and a native Share Extension with an App Group outbox (capture portions of C07, C09, C11). Only capture commands need offline retry in this milestone; profile/document editing remains online or on web.
4. Add a web capture Inbox so the shared URL appears on both clients. Save a LinkedIn URL even without a description; offer pasted text or an employer URL rather than blocking on automatic resolution.
5. Verify one real journey: LinkedIn/Safari share → Saved locally or Saved to Dossier → Inbox on phone and web → user supplies missing content → existing web preparation flow. Verify signed-out/offline/duplicate cases before extending scope.

This is the first useful beta, not the full native workspace. Automatic career-site discovery, native document editing, native sending, push and local AI follow later. Server job recoverability is required before native generation is shipped, not before read-only browsing and capture.

Deployment guardrail: native API changes requiring new migrations need an explicit backup/migration rollout; merging them alone does not guarantee the auto-deployer will install them. Keep mobile/server API compatibility explicit because installed phone builds do not update with the web server.

## Tasks and dependencies

Each task should be a reviewable change. Completion requires its acceptance criteria, not just new types or endpoints. Dependencies name prerequisite task IDs. Effort is deliberately unspecified until the API and Apple development environment audits are complete.

### Foundation

- [x] **C01 — Integrate the fork baseline.** Incorporate remote main / Dossier 1.14.0 through PR #2, preserve fork and mobile changes, then integrate PR #1 into fork main. Run relevant checks and record actual merge outcomes. Do not silently deploy the new branch to production. Dependency: none. Acceptance: clean tracked tree, documented resulting SHA, no loss of fork functionality; pre-existing untracked artifacts preserved.
- [ ] **C02 — Define domain commands and contracts.** Inventory web actions and mobile journeys; specify IDs, timestamps, application states, pagination, error envelopes, job events and document versions. Define candidate capture states separately from application progress. Dependency: C01. Acceptance: an API contract and fixtures cover capture → analyze → review → prepare → track, including missing posting text and expired jobs.
- [ ] **C03 — Extract shared application services.** Move reusable operations behind server-side functions; web actions retain web adaptation and call those services. Keep authorization at each public entry and invariants in services. Dependency: C02. Acceptance: existing web behavior and meaningful domain tests pass; no duplicate prompt/fact-check/document/status implementation for mobile.
- [ ] **C04 — Establish native project and delivery.** Audit Xcode/SDK/signing availability; create SwiftUI iPhone/iPad project, build configurations and API environment selection. Set bundle IDs and extension targets. Dependency: C02. Acceptance: debug build on simulator and installation path for the user's device; explicit signing prerequisites; no provider secrets bundled. Native UI test code requires the repository's prescribed device exploration first.

### Shared server boundary

- [ ] **C05 — Add mobile authentication.** Design device sessions with expiry, revocation, rate limiting and secure token storage. Preserve web cookie sessions; do not expose stored provider credentials. Dependency: C03. Acceptance: native sign-in/sign-out, expired-session recovery and device revocation work; unauthenticated data requests fail; auth secrets do not appear in logs.
- [ ] **C06 — Implement versioned resource APIs.** Add authenticated profile, candidate, application, notes/history and document endpoints backed by C03. Provide a published contract and generated/validated client models where practical. Dependency: C02, C03, C05. Acceptance: web and native commands reach the same services; pagination and errors are stable; permission tests cover each endpoint.
- [ ] **C07 — Protect edits and retries.** Add record versions / conditional updates, idempotency keys for capture and mutating commands, duplicate detection and explicit conflict responses. Dependency: C06. Acceptance: a stale phone edit cannot overwrite newer web data; retries cannot duplicate a candidate, generation command or send; the UI can recover the user's unsent text.
- [ ] **C08 — Make job execution recoverable.** Audit current process-local queue and restart recovery; persist accepted job intent, atomically claim work and define retry/cancellation behavior. Keep a single process initially if sufficient. Add API job status/events with reconnect support. Dependency: C03, C05. Acceptance: phone disconnect does not cancel accepted work; server restart produces a documented recoverable or explicit failed state rather than silently losing work; client reconnect finds the result; duplicate retry does not duplicate side effects.

### Job capture and enrichment

- [ ] **C09 — Persist capture Inbox.** Save URL, optional shared text/note, source, capture time and idempotency key before enrichment. Canonicalize URLs and preserve the original discovery link. Dependency: C06, C07. Acceptance: authenticated captures become visible on web and native; valid links remain saved if extraction fails; network failures remain visibly pending on the phone.
- [ ] **C10 — Resolve official postings.** Support known employer/ATS sources through documented APIs and permitted retrieval. Use company/title supplied by the user when a LinkedIn job ID alone is insufficient. Preserve candidate matches, canonical URL, requisition ID, retrieved text/time and provenance. Enforce URL/network validation at every redirect to prevent requests to private/internal services. Dependency: C09. Acceptance: high-confidence matches show evidence, ambiguous matches require selection, denied/missing/closed postings have explicit states, and pasted text is an available fallback. No login scraping, access-control bypass or guessed job descriptions.
- [ ] **C11 — Add native Share Extension.** Receive URL/text from the system share sheet, persist through an App Group outbox, authenticate using a designed shared credential mechanism and send a lightweight capture request. Display Saved locally versus Saved to Dossier accurately. Dependency: C04, C05, C09. Acceptance: verify actual LinkedIn and Safari payloads on device; saving does not require waiting for AI; repeated shares deduplicate; offline capture survives extension termination; upload retries occur when the system permits, without a promise of immediate background execution.

### Native user journeys

- [ ] **C12 — Ship the native workspace.** Implement sign-in, Inbox, applications list/detail, status changes, notes, profile editor and conflict/error states. Add cache isolation by signed-in session and clear appropriate cached data on sign-out. Dependency: C04–C07, C09. Acceptance: edits on iOS appear on web and vice versa after refresh; cached content is labeled when stale; pending work is recoverable; Dynamic Type and VoiceOver are usable.
- [ ] **C13 — Add analysis and document review.** Start server extraction/scoring/generation jobs, show reconnectable progress, review factual gaps, edit drafts and access versioned PDFs/text. Tie generation to explicit profile/posting/document input versions and detect stale results. Dependency: C08, C10, C12. Acceptance: starting on iOS and reviewing on web works; newer manual edits are not silently overwritten by an older job; the same canonical document is downloaded on both clients.
- [ ] **C14 — Add action approval and tracking.** Expose supported send/integration actions with review of recipient, attachments and content; retain explicit user confirmation. External employer application forms open in the browser, with manual submission confirmation unless a supported integration provides evidence. Dependency: C07, C13. Acceptance: Prepare/Approved/Sent/Submitted do not collapse into one status; retries cannot send twice; audit history records outcomes; failed actions do not falsely advance tracking.

### Release and follow-up

- [ ] **C15 — Validate the whole journey and release.** Complete contract, server and native checks; verify device sharing and narrow-screen/tablet accessibility. Back up production data, test schema changes on a copy, deploy additive API changes first, then distribute the native beta. Document app/API compatibility and rollback. Dependency: C11–C14. Acceptance: share → Inbox → resolve/paste → analyze → review → prepare → track works on iOS and web; bad network, auth expiry, restart, duplicates and concurrent edits are exercised. Validate existing web features and fork providers too.
- [ ] **C16 — Optional local AI and push enhancements.** Benchmark on-device summaries/rewrites against real tasks; retain server validation for accepted official documents. Evaluate push notifications for completed jobs and follow-ups. Dependency: C15. Acceptance: measurable usefulness and privacy behavior, runtime capability checks, no silent remote fallback, and no second canonical generation pipeline. This task is outside initial release scope.

## Delivery slices

1. **Read and capture beta:** the bounded milestone above: minimal portions of C02/C03/C05/C06/C07 plus C04, C09, C11 and read-only C12. No native generation or profile mutation yet; C08 is completed before those generation features ship. C10 initially offers pasted text/manual employer links.
2. **Application preparation beta:** complete C10, C12 and C13. Shared quality pipeline, profile editing, document review and reliable cross-device state.
3. **Tracking and release:** C14–C15. Supported sending, clear submission states, resilience and production rollout.
4. **Measured enhancements:** C16. Local AI and push only after the shared foundation is working well.

Slices describe capability milestones; they do not waive prerequisite acceptance criteria for the functions shipped in that slice.

## Quality and decision gates

- Maintain a small evaluation set of profiles and postings with known facts, gaps and expected extraction. Measure factual errors, missed requirements, user corrections, duplicate captures and completion failures; avoid invented quality percentages.
- Preserve original posting text and generation input versions so the user can understand why a document says what it says.
- Keep credentials on the server for provider calls. Availability of a provider adapter does not establish that its CLI/authentication is configured in production.
- Choose SQLite versus PostgreSQL, a separate worker, or a dedicated queue only after reviewing concurrency, recovery and operational requirements. A native API does not itself require splitting the monolith.
- Confirm signing/distribution expectations, document-editing scope and supported integration actions during C02/C04 before promising a release date.

## Provider expansion: Apple Calendar and iCloud Mail

- [ ] **C17 — Provider-neutral integration capabilities.** Separate email and calendar provider selection. Preserve Google behavior. Define explicit capabilities (compose, server send, inbox read, add event, availability read, event sync), linked external IDs and per-provider errors. Native device permissions never imply server access. Dependency: C02/C03. Acceptance: unsupported capabilities are visible, never silently substituted; Google tests pass.
- [ ] **C18 — Native Apple Calendar.** Add user-reviewed interview creation using EventKitUI initially, with minimal permissions. Keep the Dossier interview record authoritative; cancellation does not mark it exported. Later add authorized availability/read and update reconciliation separately. Dependency: C04/C12/C17. Acceptance: calendar picker, permission denial, cancellation and event linkage are handled; local calendar data is not uploaded without consent.
- [ ] **C19 — Native Apple Mail compose.** Use MessageUI to prepare reviewed application text and canonical PDF attachments. Check availability and offer appropriate fallback. Composer outcomes do not prove delivery or employer submission. Dependency: C04/C13/C17. Acceptance: no send without user action; cancellation preserves draft; unsupported Mail configuration is recoverable.
- [ ] **C20 — Server iCloud Mail.** Implement TLS IMAP/SMTP adapters with app-specific credential storage, revocation, message linking, deduplication and approved sending. Use the email security skills before processing inbound content: email is untrusted data and cannot authorize actions. Keep secrets outside logs and clients. Dependency: C14/C17. Acceptance: web/iOS share mailbox state; incoming messages cannot trigger sending or tool execution; credentials are encrypted at rest; retries reconcile uncertain send outcomes without blind duplicate sends.
- [ ] **C21 — Calendar cross-client semantics.** Define EventKit linkage versus provider-account server sync. Web shows Dossier interviews even when calendar export is device-only. Do not promise server-side iCloud availability or automatic two-way calendar sync in initial release. Dependency: C18. Acceptance: no duplicate exported interviews, explicit stale/unavailable state, accurate time zones.

## Implementation management

Parallel work begins with backend authentication/read APIs, native SwiftUI shell and Apple device integrations, and job capture/domain services. Each worker uses an isolated T3-managed checkout and a focused PR. The manager integrates contracts and checks cross-client behavior before merging. No worker independently merges overlapping changes or deploys production.

Initial native API contract (v1): JSON under `/api/mobile/v1`, errors `{error:{code,message}}`, ISO-8601 UTC timestamps; authenticated device-session requests use `Authorization: Bearer <opaque-token>`; plaintext token only at creation, hash stored server-side. Sign-in accepts existing Dossier password over HTTPS; tokens require expiry, revocation and login throttling. Application list uses `{items,nextCursor}`, application detail `{application}`, captures use `{capture}` and accept `{url,text?,note?,clientRequestId}`. Client routes remain configurable. Full schema details are owned by the backend contract document and reconciled before integration.

Capture states: `SAVED`, `NEEDS_DETAILS`, `READY`, `FAILED` describe ingestion only, never employer submission. Preserve original URL; idempotency is scoped to authenticated installation/session owner. Share Extension persists locally before upload; a native cache is not authoritative application state. Official-posting resolution starts with existing safe fetch/paste fallback; no unauthorized LinkedIn retrieval.

Production rollout: additive server API first; any migration triggers the existing deployer's manual migration gate, requiring a consistent backup and explicit rollout. Preserve Google, ChatGPT connection, credentials and source data. Native signing or physical-device approval may require the user; complete simulator/build verification and all independently authorized work first.
