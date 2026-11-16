import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import { emptyWorkAuthorization } from "@/lib/work-authorization";

import { saveWorkAuthorization } from "./actions";
import { WorkAuthorizationSection } from "./work-authorization-section";

vi.mock("./actions", () => ({
  saveWorkAuthorization: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("@/components/save-tracker", () => ({
  useTrackSave: () => (promise: Promise<unknown>) => promise,
}));

function Harness() {
  const [profile, setProfile] = useState(() => ({ ...demoProfile(), workAuthorization: emptyWorkAuthorization() }));
  return (
    <WorkAuthorizationSection
      profile={profile}
      update={(change) => setProfile(change)}
    />
  );
}

describe("WorkAuthorizationSection", () => {
  it("autosaves tri-state sponsorship as yes, no, or not set", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const sponsorship = screen.getByRole("group", {
      name: "Do you need visa sponsorship for your next role?",
    });

    await user.click(within(sponsorship).getByRole("radio", { name: "No" }));
    await waitFor(() => expect(saveWorkAuthorization).toHaveBeenCalledWith(expect.objectContaining({ needsSponsorshipNow: false })));

    await user.click(within(sponsorship).getByRole("radio", { name: "Yes" }));
    await waitFor(() => expect(saveWorkAuthorization).toHaveBeenLastCalledWith(expect.objectContaining({ needsSponsorshipNow: true })));

    await user.click(within(sponsorship).getByRole("radio", { name: "Not set" }));
    await waitFor(() => expect(saveWorkAuthorization).toHaveBeenLastCalledWith(expect.objectContaining({ needsSponsorshipNow: null })));
  });
});
