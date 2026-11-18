import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { patchProfileBasics, readProfileBasics, writeProfileBasics } from "./profile-basics";
import { loadProfile } from "./profile-data";

const db = createTestClient();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

describe("profile basics with several profiles", () => {
  it("keeps shared basics and work authorization while headline and summary stay on each profile", async () => {
    const second = await db.profile.create({ data: { id: "second", name: "Another profile" } });
    await db.profileField.createMany({
      data: [
        { key: "needsSponsorshipNow", value: "yes" },
        { key: "workAuthAuthorizedCountries", value: '["Netherlands"]' },
      ],
    });

    await writeProfileBasics(
      {
        name: "Jane Doe",
        headline: "Product designer",
        email: "jane@example.com",
        phone: "",
        dob: "",
        website: "",
        address: "",
        city: "Rotterdam",
        country: "Netherlands",
        linkedin: "",
        summary: "Designs useful products.",
        showAge: false,
      },
      TEST_PROFILE_ID,
      db,
    );
    await patchProfileBasics({ headline: "Design lead", summary: "Leads product design." }, second.id, db);

    const [detail, basics] = await Promise.all([loadProfile(undefined, db), readProfileBasics(undefined, db)]);
    expect(detail.basics).toEqual(basics);
    expect(basics).toMatchObject({
      name: "Jane Doe",
      headline: "Product designer",
      email: "jane@example.com",
      city: "Rotterdam",
      summary: "Designs useful products.",
    });
    await expect(readProfileBasics(second.id, db)).resolves.toMatchObject({
      name: "Jane Doe",
      headline: "Design lead",
      email: "jane@example.com",
      city: "Rotterdam",
      summary: "Leads product design.",
    });
    await expect(
      db.profileField.findMany({ where: { key: { in: ["needsSponsorshipNow", "workAuthAuthorizedCountries"] } }, orderBy: { key: "asc" } }),
    ).resolves.toEqual([
      { key: "needsSponsorshipNow", value: "yes", updatedAt: expect.any(Date) },
      { key: "workAuthAuthorizedCountries", value: '["Netherlands"]', updatedAt: expect.any(Date) },
    ]);
  });
});
