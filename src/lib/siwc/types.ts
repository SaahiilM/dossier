/** Stored OAuth record for one ChatGPT account registration (issued client ID + subject). */
export type StoredCredential = {
  sub: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  scopes: string[];
  hostId: string;
  savedAt: string;
  email?: string;
  name?: string;
  picture?: string;
};

/** Redacted account row for settings UI — no bearer or refresh tokens. */
export type AccountSummary = {
  sub: string;
  clientId: string;
  email?: string;
  name?: string;
  picture?: string;
  hasDirectUsage: boolean;
};

export type SignInPhase = "idle" | "pending" | "processing" | "succeeded" | "failed" | "cancelled";

/** Safe diagnostic categories shown to users; never contains provider response text. */
export type SignInFailureCode =
  | "authorization_denied"
  | "provider_unavailable"
  | "token_exchange"
  | "token_response"
  | "token_validation"
  | "scope_not_granted"
  | "credential_storage"
  | "timeout"
  | "callback_listener"
  | "unknown";

export type BeginSignInOptions = {
  /** Issued client ID for reauthorization; omit for first-time dynamic registration. */
  clientId?: string;
  idTokenHint?: string;
  loginHint?: string;
};

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  id_token: string;
  token_type?: string;
  expires_in?: number;
  scope: string;
};
