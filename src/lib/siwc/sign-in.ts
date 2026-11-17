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
import type { AccountSummary, BeginSignInOptions, SignInFailureCode, SignInPhase, StoredCredential } from "./types";

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
  processing: boolean;
};

let pending: PendingSignIn | undefined;
let phase: SignInPhase = "idle";
let failureCode: SignInFailureCode | undefined;

export function getSignInPhase(): SignInPhase {
  return pending?.processing ? "processing" : pending ? "pending" : phase;
}

export function getSignInFailureCode(): SignInFailureCode | undefined {
  return failureCode;
}

export function isSignInPending(): boolean {
  return pending !== undefined;
}

export function getSignInResult(): Promise<AccountSummary> | undefined {
  if (!pending?.result) return undefined;
  return pending.result;
}

let activeReject: ((error: Error) => void) | undefined;

export async function beginSignIn(options: BeginSignInOptions = {}): Promise<string> {
  if (pending) throw new Error("Sign in is already in progress");
  phase = "idle";
  failureCode = undefined;

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
      if (error instanceof SignInCancelledError) {
        phase = "cancelled";
      } else {
        phase = "failed";
        failureCode = classifySignInFailure(error);
      }
      reject(error);
    };

    const server = createServer((req, res) => {
      const current = pending;
      if (!current || req.method !== "GET") {
        res.writeHead(404).end();
        return;
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/auth/callback") {
        res.writeHead(404).end();
        return;
      }

      if (url.searchParams.get("state") !== current.state) {
        res.writeHead(400).end("Invalid sign-in state");
        return;
      }

      if (current.processing) {
        res.writeHead(409, { "content-type": "text/plain" }).end("Sign-in is already being completed.");
        return;
      }

      const oauthError = url.searchParams.get("error");
      if (oauthError) {
        res.writeHead(400, { "content-type": "text/plain" }).end("Sign-in was not completed. Return to Dossier for details.");
        finish(new Error(oauthError === "access_denied" ? "ChatGPT sign-in was declined" : "Authorization was not completed"));
        return;
      }

      const code = url.searchParams.get("code");
      const callbackClientId = url.searchParams.get("client_id");
      if (!code) {
        res.writeHead(400).end("Missing authorization code");
        return;
      }

      let exchangeClientId = current.expectedClientId;
      if (current.isNewRegistration) {
        if (!callbackClientId || callbackClientId === DYNAMIC_CLIENT) {
          res.writeHead(400).end("Missing issued client ID");
          return;
        }
        exchangeClientId = callbackClientId;
      } else if (callbackClientId && callbackClientId !== current.expectedClientId) {
        res.writeHead(400).end("Unexpected client ID");
        return;
      }

      current.processing = true;
      phase = "processing";
      clearTimeout(current.timer);
      void (async () => {
        try {
          const credential: StoredCredential = await exchangeAuthorizationCode({
            code,
            clientId: exchangeClientId,
            verifier: current.verifier,
            redirectUri: current.redirectUri,
            nonce: current.nonce,
            hostId,
          });
          let summary: AccountSummary;
          try {
            summary = await withCredentialsStore(async (rows) => ({
              rows: upsertCredential(rows, credential),
              result: toAccountSummary(credential),
            }));
          } catch {
            throw new Error("Credential storage failed");
          }
          res.writeHead(200, { "content-type": "text/plain" }).end("Sign-in complete. You can close this window.");
          phase = "succeeded";
          resolveResult(summary);
          cleanup(current.server);
        } catch (error) {
          const normalized = error instanceof Error ? error : new Error("Sign-in failed");
          const code = classifySignInFailure(normalized);
          res.writeHead(502, { "content-type": "text/plain" }).end(`Sign-in failed (${code}). Return to Dossier for details.`);
          finish(normalized);
        }
      })().catch((error: unknown) => {
        // The async callback handler is deliberately contained so no exchange or
        // storage failure can escape as an unhandled rejection.
        finish(error instanceof Error ? error : new Error("Sign-in failed"));
      });
    });

    const cleanup = (server: Server) => {
      if (pending?.server === server) {
        clearTimeout(pending.timer);
        pending = undefined;
        activeReject = undefined;
      }
      if (server.listening) setImmediate(() => server.close());
    };

    const finish = (error: Error) => {
      if (settled) return;
      const reject = activeReject;
      cleanup(server);
      reject?.(error);
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
        processing: false,
      };
      phase = "pending";
    });

    server.on("error", (error) => {
      finish(error instanceof Error ? error : new Error("Sign-in listener error"));
    });
  });
  // Listener startup can fail before the caller receives the authorization URL.
  void result.catch(() => undefined);

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

  void result.then(
    () => {
      if (phase === "succeeded" || phase === "failed" || phase === "cancelled") {
        pending = undefined;
        activeReject = undefined;
      }
    },
    () => {
      if (phase === "succeeded" || phase === "failed" || phase === "cancelled") {
        pending = undefined;
        activeReject = undefined;
      }
    },
  );

  return `${AUTH_URL}?${params}`;
}

function classifySignInFailure(error: Error): SignInFailureCode {
  const message = error.message.toLowerCase();
  if (message.includes("declined")) return "authorization_denied";
  if (message.includes("authorization was not completed")) return "authorization_denied";
  if (message.includes("timed out")) return "timeout";
  if (message.includes("listener") || message.includes("bind")) return "callback_listener";
  if (message.includes("missing required scope") || message.includes("direct plan usage")) return "scope_not_granted";
  if (message.includes("incomplete token response") || message.includes("invalid refresh response")) return "token_response";
  if (message.includes("token exchange failed")) return "token_exchange";
  if (message.includes("discovery") || message.includes("network") || message.includes("fetch")) return "provider_unavailable";
  if (message.includes("id token") || message.includes("issuer") || message.includes("nonce") || message.includes("subject")) {
    return "token_validation";
  }
  if (
    message.includes("credential storage") ||
    message.includes("credentials") ||
    message.includes("permission") ||
    message.includes("eacces") ||
    message.includes("erofs")
  ) {
    return "credential_storage";
  }
  return "unknown";
}

/** Closes the loopback listener without rejecting an in-flight sign-in (tests and abandoned URL prefetch). */
export function abandonSignInAttempt(): void {
  if (!pending) return;
  if (pending.processing) return;
  const { server, timer } = pending;
  clearTimeout(timer);
  server.close();
  pending = undefined;
  activeReject = undefined;
  if (phase === "pending") phase = "idle";
}

export function cancelSignIn(): void {
  if (!pending) return;
  if (pending.processing) return;
  const { server, timer } = pending;
  clearTimeout(timer);
  server.close();
  const emit = activeReject;
  pending = undefined;
  activeReject = undefined;
  emit?.(new SignInCancelledError());
}
