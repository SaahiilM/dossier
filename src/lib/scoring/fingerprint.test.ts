import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";

import type { ScoringConfig } from "./config";
import { postingContentHash, scoreInputFingerprint, scorerPolicyVersion } from "./fingerprint";

const posting = {
  title: "Designer",
  company: "Acme",
  place: "Berlin",
  remote: false,
  salary: "",
  description: "Figma required.",
};
const profile = demoProfile();
const day = new Date("2026-11-12T12:00:00Z");

const config = (scorer: ScoringConfig["scorer"], model = ""): ScoringConfig => ({
  scorer,
  saved: true,
  key: null,
  keyState: "none",
  openRouterModel: model,
  openRouterKey: null,
  openRouterKeyState: "none",
  openRouterKeyEnv: "DOSSIER_OPENROUTER_SCORING_KEY",
});

describe("scoreInputFingerprint", () => {
  it("changes when the scorer, model, profile work auth, or reference date changes", () => {
    const base = scoreInputFingerprint(profile, posting, config("JEV"), day);
    expect(scoreInputFingerprint(profile, posting, config("AI"), day)).not.toBe(base);
    expect(
      scoreInputFingerprint(profile, posting, config("OPENROUTER_DECISIONS", "perplexity/pplx-decider-v1.3:free"), day),
    ).not.toBe(base);
    expect(
      scoreInputFingerprint(profile, posting, config("OPENROUTER_DECISIONS", "openai/gpt-4.1-mini"), day),
    ).not.toBe(
      scoreInputFingerprint(profile, posting, config("OPENROUTER_DECISIONS", "perplexity/pplx-decider-v1.3:free"), day),
    );
    const withAuth = {
      ...profile,
      workAuthorization: { ...profile.workAuthorization, authorizedCountries: ["Germany"] },
    };
    expect(scoreInputFingerprint(withAuth, posting, config("JEV"), day)).not.toBe(base);
    expect(scoreInputFingerprint(profile, posting, config("JEV"), new Date("2026-11-13T12:00:00Z"))).not.toBe(base);
  });

  it("keeps posting hash stable for equivalent Jev text", () => {
    expect(postingContentHash(posting)).toBe(postingContentHash({ ...posting, description: `  ${posting.description}  ` }));
  });

  it("versions Jev policy with prompt version and question weights", () => {
    expect(scorerPolicyVersion(config("JEV"))).not.toBe(scorerPolicyVersion(config("OPENROUTER")));
  });
});
