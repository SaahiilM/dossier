import { createRemoteJWKSet, jwtVerify } from "jose";

import {
  DIRECT_USAGE_SCOPE,
  DISCOVERY_URL,
  ISSUER,
  OAUTH_FETCH_TIMEOUT_MS,
  REQUIRED_SCOPES,
  RESOURCE,
  TOKEN_URL,
} from "./constants";
import type { StoredCredential, TokenResponse } from "./types";

type Discovery = { issuer: string; jwks_uri: string; revocation_endpoint?: string };

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let discovery: Discovery | undefined;

async function oauthFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const timeout = AbortSignal.timeout(OAUTH_FETCH_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(url, { ...init, signal });
}

async function openIdConfig(): Promise<Discovery> {
  if (discovery) return discovery;
  const response = await oauthFetch(DISCOVERY_URL);
  if (!response.ok) throw new Error("OpenID discovery failed");
  discovery = (await response.json()) as Discovery;
  return discovery;
}

export function parseScopeList(scope: string): string[] {
  return scope.split(/\s+/).filter(Boolean);
}

export function requireScopes(granted: string[]): void {
  for (const needed of REQUIRED_SCOPES) {
    if (!granted.includes(needed)) throw new Error(`Missing required scope: ${needed}`);
  }
}

export function hasDirectUsage(scopes: string[]): boolean {
  return scopes.includes(DIRECT_USAGE_SCOPE);
}

export async function validateIdToken(idToken: string, clientId: string, nonce: string) {
  const config = await openIdConfig();
  if (config.issuer !== ISSUER) throw new Error("ID token issuer mismatch");
  jwks ??= createRemoteJWKSet(new URL(config.jwks_uri));
  const { payload } = await jwtVerify(idToken, jwks, { issuer: ISSUER, audience: clientId });
  if (payload.nonce !== nonce) throw new Error("ID token nonce mismatch");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("ID token subject missing");
  return payload;
}

async function validateRefreshedIdToken(idToken: string, clientId: string, expectedSub: string) {
  const config = await openIdConfig();
  if (config.issuer !== ISSUER) throw new Error("ID token issuer mismatch");
  jwks ??= createRemoteJWKSet(new URL(config.jwks_uri));
  const { payload } = await jwtVerify(idToken, jwks, { issuer: ISSUER, audience: clientId });
  if (payload.sub !== expectedSub) throw new Error("ID token subject mismatch after refresh");
  return payload;
}

export function credentialFromTokenResponse(
  tokens: TokenResponse,
  clientId: string,
  hostId: string,
  nonce: string,
  profile: { sub: string; email?: string; name?: string; picture?: string },
): StoredCredential {
  const scopes = parseScopeList(tokens.scope);
  requireScopes(scopes);
  if (!hasDirectUsage(scopes)) throw new Error("ChatGPT direct plan usage was not granted");
  const expiresIn = Number(tokens.expires_in ?? 3600);
  return {
    sub: profile.sub,
    clientId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: Date.now() + expiresIn * 1000,
    scopes,
    hostId,
    savedAt: new Date().toISOString(),
    email: profile.email,
    name: profile.name,
    picture: profile.picture,
  };
}

export async function exchangeAuthorizationCode(options: {
  code: string;
  clientId: string;
  verifier: string;
  redirectUri: string;
  nonce: string;
  hostId: string;
}): Promise<StoredCredential> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: options.code,
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    code_verifier: options.verifier,
    resource: RESOURCE,
  });
  const response = await oauthFetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error("Token exchange failed");
  const tokens = (await response.json()) as TokenResponse;
  if (!tokens.access_token || !tokens.refresh_token || !tokens.id_token || !tokens.scope) {
    throw new Error("Incomplete token response");
  }
  const payload = await validateIdToken(tokens.id_token, options.clientId, options.nonce);
  return credentialFromTokenResponse(tokens, options.clientId, options.hostId, options.nonce, {
    sub: payload.sub!,
    email: typeof payload.email === "string" ? payload.email : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
  });
}

export async function refreshAccessToken(current: StoredCredential): Promise<StoredCredential> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: current.clientId,
    refresh_token: current.refreshToken,
    resource: RESOURCE,
  });
  const response = await oauthFetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error("Token refresh failed");
  const tokens = (await response.json()) as Partial<TokenResponse>;
  if (typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string") {
    throw new Error("Invalid refresh response");
  }
  const scopes = tokens.scope ? parseScopeList(tokens.scope) : current.scopes;
  if (tokens.scope) {
    requireScopes(scopes);
    if (!hasDirectUsage(scopes)) throw new Error("ChatGPT direct plan usage was not granted");
  }
  const idToken =
    typeof tokens.id_token === "string"
      ? tokens.id_token
      : current.idToken;
  if (typeof tokens.id_token === "string") {
    await validateRefreshedIdToken(tokens.id_token, current.clientId, current.sub);
  }
  const expiresIn = Number(tokens.expires_in ?? 3600);
  return {
    ...current,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + expiresIn * 1000,
    scopes,
    savedAt: new Date().toISOString(),
    idToken,
  };
}

export async function revokeRefreshToken(clientId: string, refreshToken: string): Promise<void> {
  const config = await openIdConfig();
  if (!config.revocation_endpoint) return;
  await oauthFetch(config.revocation_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: refreshToken,
      token_type_hint: "refresh_token",
      client_id: clientId,
    }),
  });
}

/** Test hook: reset cached discovery/JWKS between cases. */
export function resetOAuthCachesForTests(): void {
  jwks = undefined;
  discovery = undefined;
}
