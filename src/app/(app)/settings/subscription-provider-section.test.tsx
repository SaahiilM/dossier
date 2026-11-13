import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginChatGptSubscriptionSignIn,
  cancelChatGptSubscriptionSignIn,
  disconnectChatGptSubscription,
  getClaudeSubscriptionStatus,
  listChatGptSubscriptionModels,
  loadSubscriptionConnection,
} from "./subscription-actions";

import { SubscriptionProviderSection } from "./subscription-provider-section";
import { SUBSCRIPTION_RUNTIME_MESSAGE } from "./subscription-messages";

vi.mock("./subscription-actions", () => ({
  loadSubscriptionConnection: vi.fn(),
  beginChatGptSubscriptionSignIn: vi.fn(),
  getChatGptSubscriptionSignInStatus: vi.fn(),
  cancelChatGptSubscriptionSignIn: vi.fn(),
  disconnectChatGptSubscription: vi.fn(),
  listChatGptSubscriptionModels: vi.fn(),
  getClaudeSubscriptionStatus: vi.fn(),
}));

vi.mock("@/lib/claude-tab", () => ({
  openPendingTab: vi.fn(() => null),
  sendPendingTab: vi.fn(),
}));

vi.mock("@/components/toast", () => ({
  toast: vi.fn(),
  toastResult: (result: unknown) => result,
}));

const base: NonNullable<Parameters<typeof SubscriptionProviderSection>[0]["initial"]> = {
  chatGpt: { runtimeAvailable: false, phase: "idle", accounts: [] },
  claude: { installed: false, auth: "unknown" },
};

beforeEach(() => {
  vi.mocked(loadSubscriptionConnection).mockResolvedValue({ ok: true, data: base });
  vi.mocked(listChatGptSubscriptionModels).mockResolvedValue({ ok: true, data: { models: [], problem: null } });
  vi.mocked(getClaudeSubscriptionStatus).mockResolvedValue({ ok: true, data: { installed: false, auth: "unknown" } });
});

describe("SubscriptionProviderSection", () => {
  it("shows unavailable runtime guidance for ChatGPT on remote hosts", () => {
    render(<SubscriptionProviderSection initial={base} />);
    expect(screen.getByText(SUBSCRIPTION_RUNTIME_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/accessToken/i)).not.toBeInTheDocument();
  });

  it("lists redacted ChatGPT accounts and does not expose tokens", () => {
    render(
      <SubscriptionProviderSection
        initial={{
          chatGpt: {
            runtimeAvailable: true,
            phase: "idle",
            accounts: [{ sub: "sub", clientId: "oaiapp", email: "u@example.com", hasDirectUsage: true }],
          },
          claude: { installed: true, auth: "authenticated" },
        }}
        chatGptModel="gpt-test"
        onChatGptModelChange={vi.fn()}
      />,
    );
    expect(screen.getByText("u@example.com")).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toBeInTheDocument();
  });

  it("starts sign-in through server action and external tab helper", async () => {
    const user = userEvent.setup();
    vi.mocked(beginChatGptSubscriptionSignIn).mockResolvedValue({
      ok: true,
      data: { authorizeUrl: "https://auth.example/authorize", phase: "pending" },
    });
    render(
      <SubscriptionProviderSection
        initial={{
          chatGpt: { runtimeAvailable: true, phase: "idle", accounts: [] },
          claude: { installed: false, auth: "unknown" },
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Connect ChatGPT" }));
    expect(beginChatGptSubscriptionSignIn).toHaveBeenCalled();
    expect(cancelChatGptSubscriptionSignIn).not.toHaveBeenCalled();
  });

  it("shows Claude CLI instructions without login fields", async () => {
    const user = userEvent.setup();
    render(<SubscriptionProviderSection initial={base} claudeModel="sonnet" onClaudeModelChange={vi.fn()} tab="claude" />);
    expect(screen.getByText(/claude login/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check CLI status" }));
    expect(getClaudeSubscriptionStatus).toHaveBeenCalled();
  });

  it("disconnect confirms through action", async () => {
    const user = userEvent.setup();
    vi.mocked(disconnectChatGptSubscription).mockResolvedValue({ ok: true, data: { accounts: [] } });
    render(
      <SubscriptionProviderSection
        initial={{
          chatGpt: {
            runtimeAvailable: true,
            phase: "idle",
            accounts: [{ sub: "sub", clientId: "oaiapp", email: "u@example.com", hasDirectUsage: true }],
          },
          claude: { installed: false, auth: "unknown" },
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(disconnectChatGptSubscription).toHaveBeenCalledWith({ sub: "sub" });
  });
});
