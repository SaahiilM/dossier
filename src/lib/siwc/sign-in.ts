import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

import {
  AGENT_NAME_HINT,
  AUTH_URL,
  DYNAMIC_CLIENT,
  REQUIRED_SCOPES,
  RESOURCE,
  SIGN_IN_TIMEOUT_MS,
} from "./constants";
import { getOrCreateHostId } from "./host";
import { exchangeAuthorizationCode } from "./oauth";
import { toAccountSummary, upsertCredential, withCredentialsStore } from "./storage";
import type { AccountSummary, BeginSignInOptions, SignInPhase, StoredCredential } from "./types";

const b64url = (buffer: Buffer) => buffer.toString("base64url");

export class SignInCancelledError extends Error {
  constructor() {
    super("Sign in was cancelled");
    this.name = "SignInCancelledError";
  }
}

type PendingSignIn = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  expectedClientId: string;
  isNewRegistration: boolean;
  server: Server;
  timer: ReturnType<typeof setTimeout>;
  result: Promise<AccountSummary>;
};

let pending: PendingSignIn | undefined;
let phase: SignInPhase = "idle";
let signInObserved = false;

export function getSignInPhase(): SignInPhase {
  return pending ? "pending" : phase;
}

export function isSignInPending(): boolean {
  return pending !== undefined;
}

export function getSignInResult(): Promise<AccountSummary> | undefined {
  if (!pending?.result) return undefined;
  signInObserved = true;
  return pending.result;
}

let activeReject: ((error: Error) => void) | undefined;

export async function beginSignIn(options: BeginSignInOptions = {}): Promise<string> {
  if (pending) throw new Error("Sign in is already in progress");
  phase = "idle";
  signInObserved = false;

  const state = b64url(randomBytes(32));
  const nonce = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const hostId = await getOrCreateHostId();
  const isNewRegistration = !options.clientId;
  const authorizeClientId = options.clientId ?? DYNAMIC_CLIENT;

  let boundRedirectUri = "";
  let resolveResult!: (value: AccountSummary) => void;
  let settled = false;

  const result = new Promise<AccountSummary>((resolve, reject) => {
    resolveResult = (value: AccountSummary) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    activeReject = (error: Error) => {
      if (settled) return;
      settled = true;
      phase = error instanceof SignInCancelledError ? "cancelled" : "failed";
      if (signInObserved) reject(error);
    };

    const server = createServer((req, res) => {
      if (!pending || req.method !== "GET") {
        res.writeHead(404).end();
        return;
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/auth/callback") {
        res.writeHead(404).end();
        return;
      }

      if (url.searchParams.get("state") !== pending.state) {
        res.writeHead(400).end("Invalid sign-in state");
        finish(new Error("Sign-in state mismatch"));
        return;
      }

      const oauthError = url.searchParams.get("error");
      if (oauthError) {
        res.writeHead(200, { "content-type": "text/plain" }).end("Sign-in was not completed.");
        finish(new Error(oauthError === "access_denied" ? "ChatGPT sign-in was declined" : `Sign-in error: ${oauthError}`));
        return;
      }

      const code = url.searchParams.get("code");
      const callbackClientId = url.searchParams.get("client_id");
      if (!code) {
        res.writeHead(400).end("Missing authorization code");
        finish(new Error("Missing authorization code"));
        return;
      }

      let exchangeClientId = pending.expectedClientId;
      if (pending.isNewRegistration) {
        if (!callbackClientId || callbackClientId === DYNAMIC_CLIENT) {
          res.writeHead(400).end("Missing issued client ID");
          finish(new Error("Registration did not return an issued client ID"));
          return;
        }
        exchangeClientId = callbackClientId;
      } else if (callbackClientId && callbackClientId !== pending.expectedClientId) {
        res.writeHead(400).end("Unexpected client ID");
        finish(new Error("Callback client ID does not match the selected account"));
        return;
      }

      res.writeHead(200, { "content-type": "text/plain" }).end("Sign-in complete. You can close this window.");

      void exchangeAuthorizationCode({
        code,
        clientId: exchangeClientId,
        verifier: pending.verifier,
        redirectUri: pending.redirectUri,
        nonce: pending.nonce,
        hostId,
      })
        .then(async (credential: StoredCredential) => {
          const summary = await withCredentialsStore(async (rows) => ({
            rows: upsertCredential(rows, credential),
            result: toAccountSummary(credential),
          }));
          phase = "succeeded";
          resolveResult(summary);
        })
        .catch((error: unknown) => {
          finish(error instanceof Error ? error : new Error("Sign-in failed"));
        });
    });

    const finish = (error: Error) => {
      if (settled) return;
      clearTimeout(pending?.timer);
      const emit = activeReject;
      pending = undefined;
      activeReject = undefined;
      emit?.(error);
      setImmediate(() => server.close());
    };

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        finish(new Error("Callback listener failed to bind"));
        return;
      }
      boundRedirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
      const timer = setTimeout(() => {
        finish(new Error("Sign-in timed out"));
      }, SIGN_IN_TIMEOUT_MS);

      pending = {
        state,
        nonce,
        verifier,
        redirectUri: boundRedirectUri,
        expectedClientId: authorizeClientId,
        isNewRegistration,
        server,
        timer,
        result,
      };
      phase = "pending";
    });

    server.on("error", (error) => {
      if (!pending) return;
      finish(error instanceof Error ? error : new Error("Sign-in listener error"));
    });
  });
  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (boundRedirectUri) {
        resolve();
        return;
      }
      if (phase === "failed") {
        reject(new Error("Callback listener failed to start"));
        return;
      }
      setTimeout(check, 5);
    };
    check();
  });

  if (!boundRedirectUri) throw new Error("Callback listener failed to start");

  const params = new URLSearchParams({
    client_id: authorizeClientId,
    response_type: "code",
    redirect_uri: boundRedirectUri,
    scope: REQUIRED_SCOPES.join(" "),
    resource: RESOURCE,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: challenge,
    ext_agent_host_id: hostId,
  });
  if (isNewRegistration) params.set("agent_name_hint", AGENT_NAME_HINT);
  if (options.idTokenHint) params.set("id_token_hint", options.idTokenHint);
  if (options.loginHint) params.set("login_hint", options.loginHint);

  void result.finally(() => {
    if (phase === "succeeded" || phase === "failed" || phase === "cancelled") {
      pending = undefined;
      activeReject = undefined;
    }
  });

  return `${AUTH_URL}?${params}`;
}

/** Closes the loopback listener without rejecting an in-flight sign-in (tests and abandoned URL prefetch). */
export function abandonSignInAttempt(): void {
  if (!pending) return;
  const { server, timer } = pending;
  clearTimeout(timer);
  server.close();
  pending = undefined;
  activeReject = undefined;
  if (phase === "pending") phase = "idle";
}

export function cancelSignIn(): void {
  if (!pending) return;
  const { server, timer } = pending;
  clearTimeout(timer);
  server.close();
  const emit = activeReject;
  pending = undefined;
  activeReject = undefined;
  if (signInObserved) emit?.(new SignInCancelledError());
  else phase = "cancelled";
}
