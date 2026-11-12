import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SUBSCRIPTION_RUNTIME_MESSAGE } from "../../(app)/settings/subscription-messages";

import { AiStep, type AiStepView } from "./ai-step";

vi.mock("./actions", () => ({
  connectAi: vi.fn(),
  findLocalAi: vi.fn(),
}));
vi.mock("../../(app)/settings/actions", () => ({
  saveAiProvider: vi.fn(async () => ({ ok: true, data: { keyState: "none" } })),
  saveChatGptAccountSub: vi.fn(async () => ({ ok: true, data: null })),
  testAiConnection: vi.fn(),
}));
vi.mock("../../(app)/settings/subscription-provider-section", () => ({
  SubscriptionProviderSection: () => <p>{SUBSCRIPTION_RUNTIME_MESSAGE}</p>,
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { saveAiProvider } from "../../(app)/settings/actions";

const fresh: AiStepView = {
  usable: false,
  name: "",
  model: "",
  choice: null,
  chatGptAccountSub: "",
  fromEnv: false,
};

beforeEach(() => {
  vi.mocked(saveAiProvider).mockClear();
});

describe("setup guide AiStep (E21-2)", () => {
  it("shows the subscription priority with ChatGPT plan and Claude Code", async () => {
    const user = userEvent.setup();
    render(<AiStep current={fresh} />);
    await user.click(screen.getByRole("radio", { name: "My subscription" }));
    expect(screen.getByRole("radio", { name: "ChatGPT plan" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Claude Code" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "OpenAI API" })).not.toBeInTheDocument();
  });

  it("saves CHATGPT_SUBSCRIPTION and reuses subscription controls without an API key field", async () => {
    const user = userEvent.setup();
    render(<AiStep current={fresh} />);
    await user.click(screen.getByRole("radio", { name: "My subscription" }));
    await user.click(screen.getByRole("radio", { name: "ChatGPT plan" }));
    expect(saveAiProvider).toHaveBeenCalledWith(expect.objectContaining({ provider: "CHATGPT_SUBSCRIPTION" }));
    expect(screen.getByText(SUBSCRIPTION_RUNTIME_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByLabelText(/API key/i)).not.toBeInTheDocument();
  });

  it("resumes a working choice without forcing API key entry", () => {
    const current: AiStepView = {
      usable: true,
      name: "ChatGPT plan",
      model: "gpt-test",
      choice: "chatgpt_subscription",
      chatGptAccountSub: "sub-1",
      fromEnv: false,
    };
    render(<AiStep current={current} />);
    expect(screen.getByText(/already writes with/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/API key/i)).not.toBeInTheDocument();
  });
});
