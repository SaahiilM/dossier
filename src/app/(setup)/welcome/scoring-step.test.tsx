import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScoringView } from "@/lib/scoring/scorers";

import { saveScorer } from "../../(app)/settings/actions";
import { ScoringStep } from "./scoring-step";

vi.mock("../../(app)/settings/actions", () => ({
  saveScorer: vi.fn(),
  saveTypesafeKey: vi.fn(),
  testJev: vi.fn(),
  listOpenRouterScoringModels: vi.fn(async () => ({ ok: true, data: { models: ["google/gemini-2.5-flash"], problem: null } })),
  saveOpenRouterScoringKey: vi.fn(async () => ({ ok: true, data: { scorer: "OPENROUTER", keyState: "none", openRouterKeyState: "set", openRouterModel: "" } })),
  saveOpenRouterScoringModel: vi.fn(async () => ({ ok: true, data: { scorer: "OPENROUTER", keyState: "none", openRouterKeyState: "set", openRouterModel: "m" } })),
  testOpenRouterScoring: vi.fn(),
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
      "OpenRouter model",
    ]);
  });

  it("saves OPENROUTER when chosen", async () => {
    const user = userEvent.setup();
    render(<ScoringStep initial={ai} />);
    await user.click(screen.getByRole("radio", { name: "OpenRouter model" }));
    expect(saveScorer).toHaveBeenCalledWith({ scorer: "OPENROUTER" });
    expect(screen.getByLabelText("OpenRouter key for scoring")).toBeInTheDocument();
  });
});
