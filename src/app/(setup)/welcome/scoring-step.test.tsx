import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScoringView } from "@/lib/scoring/scorers";

import { saveScorer, testOpenRouterDecisions } from "../../(app)/settings/actions";
import { ScoringStep } from "./scoring-step";

vi.mock("../../(app)/settings/actions", () => ({
  saveScorer: vi.fn(),
  saveTypesafeKey: vi.fn(),
  testJev: vi.fn(),
  listOpenRouterScoringModels: vi.fn(async () => ({ ok: true, data: { models: ["google/gemini-2.5-flash"], problem: null } })),
  listOpenRouterDecisionModels: vi.fn(async () => ({ ok: true, data: { models: ["perplexity/pplx-decider-v1.3:free"], problem: null } })),
  saveOpenRouterScoringKey: vi.fn(async () => ({ ok: true, data: { scorer: "OPENROUTER", keyState: "none", openRouterKeyState: "set", openRouterModel: "" } })),
  saveOpenRouterScoringModel: vi.fn(async () => ({ ok: true, data: { scorer: "OPENROUTER", keyState: "none", openRouterKeyState: "set", openRouterModel: "m" } })),
  testOpenRouterScoring: vi.fn(),
  testOpenRouterDecisions: vi.fn(),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const emptyOpenRouter = { openRouterKeyState: "none" as const, openRouterModel: "" };
const ai: ScoringView = { scorer: "AI", keyState: "none", ...emptyOpenRouter };

beforeEach(() => {
  vi.mocked(saveScorer).mockReset().mockResolvedValue({ ok: true, data: { scorer: "OPENROUTER", keyState: "none", ...emptyOpenRouter } });
});

describe("setup guide ScoringStep (E21-4)", () => {
  it("offers AI, Jev and OpenRouter", () => {
    render(<ScoringStep initial={ai} />);
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Your AI",
      "Jev by TypeSafe",
      "OpenRouter decision model",
      "OpenRouter chat model",
    ]);
  });

  it("saves OPENROUTER when chosen", async () => {
    const user = userEvent.setup();
    render(<ScoringStep initial={ai} />);
    await user.click(screen.getByRole("radio", { name: "OpenRouter chat model" }));
    expect(saveScorer).toHaveBeenCalledWith({ scorer: "OPENROUTER" });
    expect(screen.getByLabelText("OpenRouter key for scoring")).toBeInTheDocument();
  });

  it("saves the decision model and checks it with the decision test", async () => {
    const user = userEvent.setup();
    vi.mocked(saveScorer).mockResolvedValueOnce({
      ok: true,
      data: { scorer: "OPENROUTER_DECISIONS", keyState: "none", openRouterKeyState: "set", openRouterModel: "perplexity/pplx-decider-v1.3:free" },
    });
    vi.mocked(testOpenRouterDecisions).mockResolvedValue({ ok: true, data: { connected: true, model: "perplexity/pplx-decider-v1.3-20261112", seconds: 0.2 } });
    render(<ScoringStep initial={{ scorer: "OPENROUTER_DECISIONS", keyState: "none", openRouterKeyState: "set", openRouterModel: "perplexity/pplx-decider-v1.3:free" }} />);
    expect(await screen.findByRole("option", { name: "perplexity/pplx-decider-v1.3:free" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check it" }));
    expect(testOpenRouterDecisions).toHaveBeenCalledWith({});
    expect(await screen.findByText("It works: the decision model answered.")).toBeInTheDocument();
  });
});
