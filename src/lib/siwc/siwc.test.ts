import { request as httpRequest } from "node:http";
import { mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dataDir = "";

vi.mock("@/lib/env", () => ({
  env: {
    get DOSSIER_DATA_DIR() {
      return dataDir;
    },
  },
}));

const jwtVerify = vi.fn();
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: (...args: unknown[]) => jwtVerify(...args),
}));

import {
  beginSignIn,
  credential,
  disconnect,
  getOrCreateHostId,
  isSignInPending,
  signInResult,
  signInStatus,
  status,
} from "./index";
import { abandonSignInAttempt, cancelSignIn } from "./sign-in";
import { loadCredentials, resetCredentialsLockForTests, saveCredentials, withCredentialsStore } from "./storage";
import {
  credentialFromTokenResponse,
  exchangeAuthorizationCode,
  parseScopeList,
  refreshAccessToken,
  requireScopes,
  resetOAuthCachesForTests,
} from "./oauth";

const tokenJson = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    access_token: "access",
    refresh_token: "refresh",
    id_token: "id",
    scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    expires_in: 3600,
    ...overrides,
  });

function hitCallback(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    httpRequest(url, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    })
      .on("error", reject)
      .end();
  });
}

function stubOAuthFetch(nonce: string) {
  jwtVerify.mockImplementation(async () => ({
    payload: { sub: "user-sub", nonce, email: "u@example.com", name: "User" },
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth/token")) {
        return new Response(tokenJson({ access_token: "new-access", refresh_token: "new-refresh" }), { status: 200 });
      }
      if (url.includes("openid-configuration")) {
        return new Response(
          JSON.stringify({ issuer: "https://auth.openai.com/", jwks_uri: "https://example/jwks" }),
          { status: 200 },
        );
      }
      if (url.includes("revoke")) return new Response("", { status: 200 });
      throw new Error(`unexpected fetch ${url} ${init?.method ?? ""}`);
    }),
  );
}

describe("SIWC storage", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "siwc-store-"));
    resetCredentialsLockForTests();
  });

  it("writes credentials atomically with mode 0600", async () => {
    await saveCredentials([
      {
        sub: "user",
        clientId: "oaiapp_test",
        accessToken: "a",
        refreshToken: "r",
        idToken: "i",
        expiresAt: Date.now() + 60_000,
        scopes: ["chatgpt.tokens.use.direct"],
        hostId: "urn:uuid:1",
        savedAt: new Date().toISOString(),
      },
    ]);
    const file = join(dataDir, "siwc", "credentials.json");
    const mode = (await stat(file)).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(await loadCredentials()).toHaveLength(1);
  });

  it("serializes concurrent upserts without losing rows", async () => {
    const row = (sub: string): Parameters<typeof saveCredentials>[0][number] => ({
      sub,
      clientId: `oaiapp_${sub}`,
      accessToken: "a",
      refreshToken: "r",
      idToken: "i",
      expiresAt: Date.now() + 60_000,
      scopes: ["chatgpt.tokens.use.direct", "openid", "profile", "email", "offline_access", "resource.invoke"],
      hostId: "urn:uuid:1",
      savedAt: new Date().toISOString(),
    });
    await Promise.all([
      withCredentialsStore(async (rows) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { rows: [...rows, row("a")], result: true };
      }),
      withCredentialsStore(async (rows) => ({ rows: [...rows, row("b")], result: true })),
    ]);
    const subs = (await loadCredentials()).map((entry) => entry.sub).sort();
    expect(subs).toEqual(["a", "b"]);
  });
});

describe("host ID", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "siwc-host-"));
  });

  it("reuses the same urn:uuid host across calls", async () => {
    const first = await getOrCreateHostId();
    const second = await getOrCreateHostId();
    expect(first).toBe(second);
    expect(first.startsWith("urn:uuid:")).toBe(true);
  });
});

describe("OAuth helpers", () => {
  it("rejects missing direct-usage scope", () => {
    expect(() => requireScopes(parseScopeList("openid email"))).toThrow(/Missing required scope/);
  });

  it("builds stored credentials from token responses", () => {
    const row = credentialFromTokenResponse(
      {
        access_token: "a",
        refresh_token: "r",
        id_token: "i",
        scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      },
      "oaiapp_x",
      "urn:uuid:host",
      "nonce",
      { sub: "sub-1", email: "u@example.com" },
    );
    expect(row.clientId).toBe("oaiapp_x");
    expect(row.scopes).toContain("chatgpt.tokens.use.direct");
    expect(row.email).toBe("u@example.com");
  });
});

describe("token refresh serialization", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "siwc-refresh-"));
    resetCredentialsLockForTests();
    await saveCredentials([
      {
        sub: "sub",
        clientId: "oaiapp_1",
        accessToken: "old",
        refreshToken: "rt",
        idToken: "id",
        expiresAt: Date.now() - 1,
        scopes: ["chatgpt.tokens.use.direct", "openid", "profile", "email", "offline_access", "resource.invoke"],
        hostId: "urn:uuid:h",
        savedAt: new Date().toISOString(),
      },
    ]);
    resetOAuthCachesForTests();
    jwtVerify.mockImplementation(async () => ({ payload: { sub: "sub" } }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetOAuthCachesForTests();
  });

  it("runs one refresh when two callers race near expiry", async () => {
    let refreshCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("oauth/token")) {
          refreshCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 30));
          return new Response(
            tokenJson({ access_token: "new-access", refresh_token: "new-refresh" }),
            { status: 200 },
          );
        }
        if (url.includes("openid-configuration")) {
          return new Response(JSON.stringify({ issuer: "https://auth.openai.com/", jwks_uri: "https://example/jwks" }), {
            status: 200,
          });
        }
        throw new Error(`unexpected fetch ${url} ${init?.method ?? ""}`);
      }),
    );

    const [a, b] = await Promise.all([credential(), credential()]);
    expect(refreshCalls).toBe(1);
    expect(a.accessToken).toBe("new-access");
    expect(b.accessToken).toBe("new-access");
    const onDisk = await loadCredentials();
    expect(onDisk[0]?.accessToken).toBe("new-access");
  });
});

describe("sign-in flow", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "siwc-signin-"));
    resetCredentialsLockForTests();
    resetOAuthCachesForTests();
  });

  afterEach(async () => {
    if (isSignInPending()) abandonSignInAttempt();
    vi.unstubAllGlobals();
    resetOAuthCachesForTests();
    jwtVerify.mockReset();
  });

  it("returns an authorize URL with PKCE, host ID, and dynamic registration", async () => {
    const url = await beginSignIn();
    expect(signInStatus()).toBe("pending");
    expect(url.startsWith("https://auth.openai.com/api/accounts/authorize?")).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(parsed.searchParams.get("agent_name_hint")).toBe("Dossier");
    expect(parsed.searchParams.get("ext_agent_host_id")?.startsWith("urn:uuid:")).toBe(true);
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(signInResult()).toBeDefined();
    abandonSignInAttempt();
  });

  it("finishes sign-in when callback state and code match", async () => {
    const url = await beginSignIn();
    const parsed = new URL(url);
    const nonce = parsed.searchParams.get("nonce")!;
    const state = parsed.searchParams.get("state")!;
    const redirectUri = parsed.searchParams.get("redirect_uri")!;
    const outcome = signInResult();
    expect(outcome).toBeDefined();
    stubOAuthFetch(nonce);

    expect(await hitCallback(`${redirectUri}?code=auth-code&state=${state}&client_id=oaiapp_cb`)).toBe(200);

    const summary = await outcome!;
    expect(summary).toMatchObject({ sub: "user-sub", clientId: "oaiapp_cb", hasDirectUsage: true });
    expect(signInStatus()).toBe("succeeded");
    const stored = await loadCredentials();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.accessToken).toBe("new-access");
  });

  it("returns HTTP 400 for a mismatched OAuth state parameter", async () => {
    const url = await beginSignIn();
    const parsed = new URL(url);
    const redirectUri = parsed.searchParams.get("redirect_uri")!;
    expect(await hitCallback(`${redirectUri}?code=auth-code&state=wrong`)).toBe(400);
    expect(signInStatus()).toBe("failed");
  });

  it("cancel does not emit an unhandled rejection when nobody awaits the result", async () => {
    const pending: unknown[] = [];
    const handler = (reason: unknown) => pending.push(reason);
    process.on("unhandledRejection", handler);
    try {
      await beginSignIn();
      cancelSignIn();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(pending).toHaveLength(0);
      expect(signInStatus()).toBe("cancelled");
    } finally {
      process.off("unhandledRejection", handler);
    }
  });
});

describe("OAuth token exchange", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetOAuthCachesForTests();
    jwtVerify.mockReset();
  });

  it("fails token exchange when the token endpoint errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 400 })));
    await expect(
      exchangeAuthorizationCode({
        code: "code",
        clientId: "oaiapp_new",
        verifier: "verifier",
        redirectUri: "http://127.0.0.1:1/auth/callback",
        nonce: "nonce",
        hostId: "urn:uuid:1",
      }),
    ).rejects.toThrow(/Token exchange failed/);
  });
});

describe("disconnect and status", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "siwc-disc-"));
    resetCredentialsLockForTests();
    resetOAuthCachesForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetOAuthCachesForTests();
  });

  it("redacts tokens in status and removes the row after disconnect", async () => {
    await saveCredentials([
      {
        sub: "sub",
        clientId: "oaiapp_1",
        accessToken: "secret-access",
        refreshToken: "secret-refresh",
        idToken: "secret-id",
        expiresAt: Date.now() + 60_000,
        scopes: ["chatgpt.tokens.use.direct"],
        hostId: "urn:uuid:1",
        savedAt: new Date().toISOString(),
        email: "u@example.com",
      },
    ]);
    const rows = await status();
    expect(rows).toEqual([
      expect.objectContaining({ sub: "sub", email: "u@example.com", hasDirectUsage: true }),
    ]);
    expect(JSON.stringify(rows)).not.toContain("secret-access");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("openid-configuration")) {
          return new Response(JSON.stringify({ revocation_endpoint: "https://revoke" }), { status: 200 });
        }
        return new Response("", { status: 200 });
      }),
    );
    await disconnect("sub");
    expect(await status()).toHaveLength(0);
  });

  it("rejects ambiguous sub when two client IDs share it", async () => {
    await saveCredentials([
      {
        sub: "same",
        clientId: "oaiapp_a",
        accessToken: "a",
        refreshToken: "r",
        idToken: "i",
        expiresAt: Date.now() + 60_000,
        scopes: ["chatgpt.tokens.use.direct"],
        hostId: "urn:uuid:1",
        savedAt: new Date().toISOString(),
      },
      {
        sub: "same",
        clientId: "oaiapp_b",
        accessToken: "b",
        refreshToken: "r2",
        idToken: "i2",
        expiresAt: Date.now() + 60_000,
        scopes: ["chatgpt.tokens.use.direct"],
        hostId: "urn:uuid:1",
        savedAt: new Date().toISOString(),
      },
    ]);
    await expect(credential("same")).rejects.toThrow(/client ID/);
  });
});

describe("refreshAccessToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    jwtVerify.mockReset();
  });

  it("rejects malformed refresh responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ access_token: "a" }), { status: 200 })));
    await expect(
      refreshAccessToken({
        sub: "s",
        clientId: "c",
        accessToken: "old",
        refreshToken: "rt",
        idToken: "id",
        expiresAt: 0,
        scopes: ["chatgpt.tokens.use.direct"],
        hostId: "h",
        savedAt: "",
      }),
    ).rejects.toThrow(/Invalid refresh response/);
  });
});
