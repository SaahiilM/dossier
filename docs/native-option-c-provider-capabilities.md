# Provider-neutral email and calendar capabilities

`src/lib/integrations/capabilities.ts` defines the small provider-neutral vocabulary for future web and native adapters:

- Email: `compose`, `server-send`, `inbox-read`.
- Calendar: `add-event`, `availability-read`, `event-sync`.
- Each operation reports `available`, `not-configured`, `permission-required`, `unsupported` or `temporarily-unavailable`; it can include a provider reason.
- Provider errors carry the provider, operation, stable error code, user-safe message and retryability. External email-thread and calendar-event IDs are stored with their provider namespace.

These types describe an integration boundary; they do not change or replace the existing Google implementation. Google sending, inbox reading, interview event creation, availability checks and event synchronization continue through their current code and permissions.

Native Apple Mail and EventKit are device capabilities. A device permission does not grant Dossier server access. Later native work can report Mail compose and EventKit add-event independently from server capabilities. Server-side iCloud Mail requires a separate, explicit secure credential setup for IMAP/SMTP and is outside the first beta. This slice does not add IMAP/SMTP, inbound message processing, or background email actions.
