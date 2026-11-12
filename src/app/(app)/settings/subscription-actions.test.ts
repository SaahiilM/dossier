import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSession } from "@/lib/auth/session";
import { messages } from "@/lib/messages";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));

const session = { persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) };

const desktop = vi.hoisted(() => ({ isDesktopApp: vi.fn(() => false) }));
vi.mock("@/lib/desktop", () => ({ isDesktopApp: desktop.isDesktopApp }));

const envMock = vi.hoisted(() => ({ DOSSIER_PUBLIC_URL: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({ env: envMock }));

const siwc = vi.hoisted(() => ({
  beginSignIn: vi.fn(async () => "https://auth.example/authorize?state=secret"),
  cancelSignIn: vi.fn(),
  disconnect: vi.fn(async () => undefined),
  signInResult: vi.fn(() => undefined),
  signInStatus: vi.fn((): import("@/lib/siwc/types").SignInPhase => "idle"),
  status: vi.fn(async () => [
    {
      sub: "user-sub",
      clientId: "oaiapp_x",
      email: "u@example.com",
      hasDirectUsage: true,
    },
  ]),
}));

vi.mock("@/lib/siwc", () => ({
  SignInCancelledError: class SignInCancelledError extends Error {},
  ...siwc,
}));

vi.mock("@/lib/ai/providers/chatgpt-subscription", () => ({
  ChatGptSubscriptionProvider: class {
    listModels = vi.fn(async () => ["gpt-test"]);
  },
}));

vi.mock("@/lib/ai/providers/claude-cli", () => ({
  findClaudeCli: vi.fn(async () => null),
  ClaudeCliProvider: vi.fn(),
}));

import {
  beginChatGptSubscriptionSignIn,
  cancelChatGptSubscriptionSignIn,
  disconnectChatGptSubscription,
  getChatGptSubscriptionSignInStatus,
  listChatGptSubscriptionModels,
  loadSubscriptionConnection,
} from "./subscription-actions";

describe("subscription-actions", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockResolvedValue(session);
    desktop.isDesktopApp.mockReturnValue(false);
    envMock.DOSSIER_PUBLIC_URL = undefined;
    delete process.env.DOSSIER_SUBSCRIPTION_LOOPBACK;
    vi.clearAllMocks();
    siwc.signInStatus.mockReturnValue("idle");
  });


  it("refuses signed-out callers", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(loadSubscriptionConnection({})).resolves.toEqual({ ok: false, error: messages.signedOut });
  });

  it("reports runtime unavailable without loopback", async () => {
    const result = await loadSubscriptionConnection({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.chatGpt.runtimeAvailable).toBe(false);
    expect(result.data.chatGpt.accounts[0]?.email).toBe("u@example.com");
    expect(result.data.chatGpt.accounts[0]).not.toHaveProperty("accessToken");
  });

  it("allows begin only on desktop runtime", async () => {
    const blocked = await beginChatGptSubscriptionSignIn({});
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error).toMatch(/desktop app|loopback/i);
    expect(siwc.beginSignIn).not.toHaveBeenCalled();

    desktop.isDesktopApp.mockReturnValue(true);
    const started = await beginChatGptSubscriptionSignIn({});
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.data.authorizeUrl).toContain("https://auth.example");
    expect(started.data.authorizeUrl).not.toContain("access");
    expect(siwc.beginSignIn).toHaveBeenCalled();
  });

  it("cancel only on runtime and never returns tokens", async () => {
    const blocked = await cancelChatGptSubscriptionSignIn({});
    expect(blocked.ok).toBe(false);
    desktop.isDesktopApp.mockReturnValue(true);
    const cancelled = await cancelChatGptSubscriptionSignIn({});
    expect(cancelled.ok).toBe(true);
    expect(siwc.cancelSignIn).toHaveBeenCalled();
  });

  it("polls redacted account rows", async () => {
    desktop.isDesktopApp.mockReturnValue(true);
    siwc.signInStatus.mockReturnValue("succeeded");
    const result = await getChatGptSubscriptionSignInStatus({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.accounts[0]).toEqual({
      sub: "user-sub",
      clientId: "oaiapp_x",
      email: "u@example.com",
      hasDirectUsage: true,
    });
  });

  it("disconnect and list models require runtime", async () => {
    expect((await disconnectChatGptSubscription({ sub: "user-sub" })).ok).toBe(false);
    expect((await listChatGptSubscriptionModels({ sub: "user-sub" })).ok).toBe(false);
    desktop.isDesktopApp.mockReturnValue(true);
    const models = await listChatGptSubscriptionModels({ sub: "user-sub" });
    expect(models.ok).toBe(true);
    if (!models.ok) return;
    expect(models.data.models).toEqual(["gpt-test"]);
  });
});
