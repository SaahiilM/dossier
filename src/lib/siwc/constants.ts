export const AUTH_URL = "https://auth.openai.com/api/accounts/authorize";
export const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
export const DISCOVERY_URL = "https://auth.openai.com/.well-known/openid-configuration";
export const ISSUER = "https://auth.openai.com/";
export const RESOURCE = "https://api.openai.com/v1";
export const DYNAMIC_CLIENT = "dynamic_agent_client";
export const AGENT_NAME_HINT = "Dossier";

export const IDENTITY_SCOPES = ["openid", "profile", "email"] as const;
export const USAGE_SCOPES = ["offline_access", "resource.invoke", "chatgpt.tokens.use.direct"] as const;
export const REQUIRED_SCOPES = [...IDENTITY_SCOPES, ...USAGE_SCOPES] as const;

export const DIRECT_USAGE_SCOPE = "chatgpt.tokens.use.direct";
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
export const TOKEN_REFRESH_SKEW_MS = 60_000;
export const OAUTH_FETCH_TIMEOUT_MS = 30_000;
export const MAX_SSE_BUFFER_BYTES = 1_000_000;
