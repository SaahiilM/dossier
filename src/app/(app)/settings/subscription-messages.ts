import type { SignInFailureCode } from "@/lib/siwc/types";

export const SUBSCRIPTION_RUNTIME_MESSAGE =
  "ChatGPT plan sign-in works in the Dossier desktop app, or when this server runs on your own computer with a loopback address. A remote site in your browser cannot finish sign-in.";

export const SIGN_IN_FAILURE_MESSAGES: Record<SignInFailureCode, string> = {
  authorization_denied: "OpenAI did not complete authorization. You can try connecting again.",
  provider_unavailable: "Dossier could not reach OpenAI sign-in services. Check server connectivity and try again.",
  token_exchange: "OpenAI rejected the authorization exchange. Try connecting again.",
  token_response: "OpenAI returned an incomplete sign-in response. Try connecting again.",
  token_validation: "Dossier could not validate the OpenAI sign-in token (issuer, audience, signature, or nonce check).",
  scope_not_granted: "OpenAI did not grant all required plan access scopes. Reconnect and allow the requested access.",
  credential_storage: "Dossier could not securely save the ChatGPT connection. Check the server data directory permissions.",
  timeout: "ChatGPT sign-in timed out before it completed. Start a new connection when ready.",
  callback_listener: "Dossier could not start its local sign-in callback listener.",
  unknown: "ChatGPT sign-in failed. Check the server logs for a safe diagnostic category.",
};
