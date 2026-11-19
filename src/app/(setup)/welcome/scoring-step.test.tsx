import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OPENROUTER_SCORING_MODEL, SCORER_INFO, SCORERS, type Scorer, type ScoringView } from "@/lib/scoring/scorers";

import { saveOpenRouterScoringModel, saveScorer, saveScoringKey, testScoringModel } from "../../(app)/settings/actions";
import { ScoringStep } from "./scoring-step";

vi.mock("../../(app)/settings/actions", () => ({
  saveScorer: vi.fn(),
  saveScoringKey: vi.fn(),
  saveOpenRouterScoringModel: vi.fn(),
  testScoringModel: vi.fn(),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const initial: ScoringView = {
  scorer: "AI",
  keys: { JEV: "none", DECISIONS: "none", OPENROUTER: "none" },
  openrouterModel: OPENROUTER_SCORING_MODEL,
};
const openrouterDecisions = SCORERS.find((scorer) => (scorer as string) === "OPENROUTER_DECISIONS");

beforeEach(() => {
  vi.mocked(saveScorer).mockReset().mockImplementation(async ({ scorer }) => ({ ok: true, data: { ...initial, scorer } }));
  vi.mocked(saveScoringKey).mockReset().mockResolvedValue({ ok: true, data: initial });
  vi.mocked(saveOpenRouterScoringModel).mockReset().mockResolvedValue({ ok: true, data: initial });
  vi.mocked(testScoringModel).mockReset().mockResolvedValue({ ok: true, data: { connected: true, model: "test-model", seconds: 0.2 } });
});

describe("setup guide ScoringStep (E21-4)", () => {
  it("offers every scorer in the shared upstream list", () => {
    render(<ScoringStep initial={initial} />);
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual(
      SCORERS.map((scorer) => (scorer === "AI" ? "Your AI" : SCORER_INFO[scorer].name)),
    );
  });

  it("saves OpenRouter through the upstream scorer and key contracts", async () => {
    const user = userEvent.setup();
    render(<ScoringStep initial={initial} />);
    await user.click(screen.getByRole("radio", { name: SCORER_INFO.OPENROUTER.name }));
    expect(saveScorer).toHaveBeenCalledWith({ scorer: "OPENROUTER" });
    expect(screen.getByLabelText(SCORER_INFO.OPENROUTER.key!.label)).toBeInTheDocument();

    await user.type(screen.getByLabelText(SCORER_INFO.OPENROUTER.key!.label), "sk-or-test");
    await user.click(screen.getByRole("button", { name: "Check it" }));
    expect(saveScoringKey).toHaveBeenCalledWith({ scorer: "OPENROUTER", change: { action: "set", value: "sk-or-test" } });
    expect(saveOpenRouterScoringModel).toHaveBeenCalledWith({ model: "", scorer: "OPENROUTER" });
    expect(testScoringModel).toHaveBeenCalledWith({ scorer: "OPENROUTER" });
    expect(await screen.findByText(`It works: ${SCORER_INFO.OPENROUTER.name} answered.`)).toBeInTheDocument();
  });

  it.skipIf(!openrouterDecisions)("keeps OpenRouter Decisions as a selectable, tested scorer", async () => {
    const scorer = openrouterDecisions as Scorer;
    const view: ScoringView = { ...initial, scorer, keys: { ...initial.keys, [scorer]: "set" } };
    const user = userEvent.setup();
    render(<ScoringStep initial={view} />);
    expect(screen.getByRole("radio", { name: SCORER_INFO[scorer].name })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Check it" }));
    expect(testScoringModel).toHaveBeenCalledWith({ scorer });
    expect(await screen.findByText(`It works: ${SCORER_INFO[scorer].name} answered.`)).toBeInTheDocument();
  });
});
