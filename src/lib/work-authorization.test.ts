import { describe, expect, it } from "vitest";

import {
  emptyWorkAuthorization,
  fieldsFromWorkAuthorization,
  workAuthorizationForScorer,
  workAuthorizationFromFields,
  workAuthorizationFilled,
  workAuthorizationSchema,
} from "./work-authorization";

describe("work authorization storage", () => {
  it("defaults to unknown tri-states and empty lists", () => {
    expect(workAuthorizationFromFields([])).toEqual(emptyWorkAuthorization());
  });

  it("round-trips through ProfileField keys", () => {
    const wa = {
      authorizedCountries: ["Canada", "Germany"],
      needsSponsorshipNow: false,
      needsSponsorshipLater: true,
      visaStatuses: [{ jurisdiction: "United Kingdom", status: "Skilled Worker" }],
      relocationWillingness: true,
      relocationPreferredCountries: ["Netherlands"],
    } satisfies ReturnType<typeof emptyWorkAuthorization>;
    const rows = Object.entries(fieldsFromWorkAuthorization(wa)).flatMap(([key, value]) =>
      value === null ? [] : [{ key, value }],
    );
    expect(workAuthorizationFromFields(rows)).toEqual(wa);
  });

  it("removes empty lists and unspecified tri-states from storage", () => {
    expect(fieldsFromWorkAuthorization(emptyWorkAuthorization())).toEqual({
      workAuthAuthorizedCountries: null,
      needsSponsorshipNow: null,
      needsSponsorshipLater: null,
      visaStatuses: null,
      relocationWillingness: null,
      relocationPreferredCountries: null,
    });
  });

  it("treats corrupt JSON as empty for that field", () => {
    expect(
      workAuthorizationFromFields([{ key: "workAuthAuthorizedCountries", value: "not-json" }]).authorizedCountries,
    ).toEqual([]);
  });
});

describe("workAuthorizationForScorer", () => {
  it("returns null when nothing is known", () => {
    expect(workAuthorizationForScorer(emptyWorkAuthorization())).toBeNull();
  });

  it("exports only user-entered facts", () => {
    expect(
      workAuthorizationForScorer({
        ...emptyWorkAuthorization(),
        authorizedCountries: ["Canada"],
        needsSponsorshipNow: false,
      }),
    ).toEqual({ authorizedCountries: ["Canada"], needsSponsorshipNow: false });
  });
});

describe("workAuthorizationFilled", () => {
  it("counts answered facets", () => {
    expect(workAuthorizationFilled(emptyWorkAuthorization())).toBe(0);
    expect(
      workAuthorizationFilled({
        ...emptyWorkAuthorization(),
        needsSponsorshipNow: false,
        authorizedCountries: ["Brazil"],
      }),
    ).toBe(2);
  });
});

describe("workAuthorizationSchema", () => {
  it("accepts bounded lists", () => {
    expect(workAuthorizationSchema.safeParse(emptyWorkAuthorization()).success).toBe(true);
  });
});
