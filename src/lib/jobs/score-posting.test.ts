import { describe, expect, it } from "vitest";

describe("scorePastedPostingJob remote detection", () => {
  it("does not treat hybrid mode as fully remote", () => {
    const hybridRemote = /\b(remote|home ?office)\b/i.test("Hybrid, 2 days remote") && !/\bhybrid\b/i.test("Hybrid, 2 days remote");
    expect(hybridRemote).toBe(false);
  });

  it("treats remote-only mode as remote", () => {
    const remoteOnly = /\b(remote|home ?office)\b/i.test("Remote") && !/\bhybrid\b/i.test("Remote");
    expect(remoteOnly).toBe(true);
  });
});
