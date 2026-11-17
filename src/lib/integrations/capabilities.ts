/** Provider-neutral operations surfaced by an email integration. */
export const EMAIL_CAPABILITIES = ["compose", "server-send", "inbox-read"] as const;
export type EmailCapability = (typeof EMAIL_CAPABILITIES)[number];

/** Provider-neutral operations surfaced by a calendar integration. */
export const CALENDAR_CAPABILITIES = ["add-event", "availability-read", "event-sync"] as const;
export type CalendarCapability = (typeof CALENDAR_CAPABILITIES)[number];

export const INTEGRATION_PROVIDERS = ["google", "apple-mail", "icloud-mail", "apple-calendar"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export type CapabilityState = "available" | "not-configured" | "permission-required" | "unsupported" | "temporarily-unavailable";

/** A capability is reported explicitly so clients never silently substitute a provider. */
export type CapabilityAvailability = {
  state: CapabilityState;
  reason?: string;
};

export type ProviderCapabilityReport = {
  provider: IntegrationProvider;
  email?: Partial<Record<EmailCapability, CapabilityAvailability>>;
  calendar?: Partial<Record<CalendarCapability, CapabilityAvailability>>;
};

/** External IDs remain provider-scoped when a Dossier record is linked elsewhere. */
export type LinkedProviderRecord = {
  provider: IntegrationProvider;
  kind: "email-thread" | "calendar-event";
  externalId: string;
  externalUrl?: string;
  linkedAt: string;
  lastSyncedAt?: string;
};

/** Provider failures retain their source and retry semantics at the boundary. */
export type ProviderOperationError = {
  provider: IntegrationProvider;
  capability: EmailCapability | CalendarCapability;
  code: string;
  message: string;
  retryable: boolean;
};
