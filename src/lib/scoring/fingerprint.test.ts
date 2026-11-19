import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import { DEFAULT_WORKPLACE } from "@/lib/profile-workplace";

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
const profile = { data: demoProfile(), levels: { from: "senior" as const, to: "lead" as const }, workplace: DEFAULT_WORKPLACE };
const day = new Date("2026-11-12T12:00:00Z");

const config = (scorer: ScoringConfig["scorer"], model = ""): ScoringConfig => ({
  scorer,
  saved: true,
  keys: {},
  openrouterModel: model || (scorer === "OPENROUTER_DECISIONS" ? "perplexity/pplx-decider-v1.3:free" : "openai/gpt-6-luna"),
});

describe("scoreInputFingerprint", () => {
  it("changes when the scorer, model, profile, workplace or reference date changes", () => {
    const base = scoreInputFingerprint(profile, posting, config("JEV"), day);
    expect(scoreInputFingerprint(profile, posting, config("AI"), day)).not.toBe(base);
    expect(scoreInputFingerprint(profile, posting, config("OPENROUTER_DECISIONS"), day)).not.toBe(base);
    expect(
      scoreInputFingerprint(profile, posting, config("OPENROUTER_DECISIONS", "other/decider:free"), day),
    ).not.toBe(scoreInputFingerprint(profile, posting, config("OPENROUTER_DECISIONS"), day));
    const withAuth = { ...profile, data: { ...profile.data, workAuthorization: { ...profile.data.workAuthorization, authorizedCountries: ["Germany"] } } };
    expect(scoreInputFingerprint(withAuth, posting, config("JEV"), day)).not.toBe(base);
    const withDifferentPlace = { ...profile, workplace: { ...DEFAULT_WORKPLACE, radiusKm: 100 as const } };
    expect(scoreInputFingerprint(withDifferentPlace, posting, config("JEV"), day)).not.toBe(base);
    expect(scoreInputFingerprint(profile, posting, config("JEV"), new Date("2026-11-13T12:00:00Z"))).not.toBe(base);
  });

  it("keeps posting hash stable for equivalent text", () => {
    expect(postingContentHash(posting)).toBe(postingContentHash({ ...posting, description: `  ${posting.description}  ` }));
  });

  it("versions the shared question policy by scorer", () => {
    expect(scorerPolicyVersion(config("JEV"))).not.toBe(scorerPolicyVersion(config("OPENROUTER")));
  });
});
