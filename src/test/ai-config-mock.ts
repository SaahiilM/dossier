/** Minimal PROVIDER_DEFAULTS for partial vi.mock("@/lib/ai/config") in db tests. */
export const PROVIDER_DEFAULTS_STUB = new Proxy(
  {},
  { get: () => ({ baseUrl: "https://openrouter.ai/api/v1", model: null, timeoutSeconds: 60 }) },
);
