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

export type SignInPhase = "idle" | "pending" | "succeeded" | "failed" | "cancelled";

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
