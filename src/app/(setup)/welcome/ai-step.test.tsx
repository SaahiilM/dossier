import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SUBSCRIPTION_RUNTIME_MESSAGE } from "../../(app)/settings/subscription-messages";

import { connectAi } from "./actions";
import { AiStep, type AiStepView } from "./ai-step";

vi.mock("./actions", () => ({ connectAi: vi.fn(), findLocalAi: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../(app)/settings/actions", () => ({
  saveAiProvider: vi.fn(async () => ({ ok: true, data: { keyState: "none" } })),
  saveChatGptAccountSub: vi.fn(async () => ({ ok: true, data: null })),
  testAiConnection: vi.fn(),
}));
vi.mock("../../(app)/settings/subscription-provider-section", () => ({
  SubscriptionProviderSection: () => <p>{SUBSCRIPTION_RUNTIME_MESSAGE}</p>,
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

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

describe("the setup guide's AI step (E21-2)", () => {
  it("shows the subscription priority with ChatGPT plan and Claude Code", async () => {
    const user = userEvent.setup();
    render(<AiStep current={fresh} />);
    await user.click(screen.getByRole("radio", { name: "My subscription" }));
    expect(screen.getByRole("radio", { name: "ChatGPT plan" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Claude Code" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "OpenAI API" })).not.toBeInTheDocument();
  });

  it("saves ChatGPT subscription and reuses subscription controls without an API key", async () => {
    const user = userEvent.setup();
    render(<AiStep current={fresh} />);
    await user.click(screen.getByRole("radio", { name: "My subscription" }));
    await user.click(screen.getByRole("radio", { name: "ChatGPT plan" }));
    expect(saveAiProvider).toHaveBeenCalledWith(expect.objectContaining({ provider: "CHATGPT_SUBSCRIPTION" }));
    expect(screen.getByText(SUBSCRIPTION_RUNTIME_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByLabelText(/API key/i)).not.toBeInTheDocument();
  });

  it("resumes a working choice without forcing API key entry", () => {
    render(
      <AiStep
        current={{
          usable: true,
          name: "ChatGPT plan",
          model: "gpt-test",
          choice: "chatgpt_subscription",
          chatGptAccountSub: "sub-1",
          fromEnv: false,
        }}
      />,
    );
    expect(screen.getByText(/already writes with/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/API key/i)).not.toBeInTheDocument();
  });

  it("sends an account without the guide's models to Settings, where its key is saved and its models are listed", async () => {
    vi.mocked(connectAi).mockResolvedValue({
      ok: true,
      data: { connected: false, kind: "model", message: "Your OpenAI account doesn't offer the models Dossier uses: gpt-6.1-terra or gpt-6-luna." },
    });
    const user = userEvent.setup();
    render(<AiStep current={{ ...fresh, choice: "openai" }} />);
    await user.type(screen.getByLabelText("OpenAI API key"), "sk-test");
    await user.click(screen.getByRole("button", { name: "Check it" }));

    expect(await screen.findByText(/doesn't offer the models Dossier uses/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings → AI provider" })).toHaveAttribute("href", "/settings?section=ai");
    expect(screen.getByRole("status")).toHaveTextContent("where your key is already saved");
  });
});
