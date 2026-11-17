import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

const db = vi.hoisted(() => ({
  client: undefined as ReturnType<typeof createTestClient> | undefined,
  signedIn: true,
}));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => (db.signedIn ? { persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) } : null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createCaptureAction, updateCaptureAction } from "./actions";

const prisma = () => db.client!;

beforeEach(async () => {
  db.signedIn = true;
  await resetDatabase(prisma());
});
afterAll(() => prisma().$disconnect());

describe("capture web actions", () => {
  it("requires the web session before creating a capture", async () => {
    db.signedIn = false;
    const result = await createCaptureAction({ url: "https://linkedin.com/jobs/view/1", clientRequestId: "signed-out" });
    expect(result).toMatchObject({ ok: false, error: expect.any(String) });
    expect(await prisma().capture.count()).toBe(0);
  });

  it("authenticates updates, validates fields and persists the web capture", async () => {
    const created = await createCaptureAction({
      url: "https://linkedin.com/jobs/view/1?trk=share",
      clientRequestId: "web-create",
    });
    expect(created).toMatchObject({ ok: true, data: { source: "WEB", ingestionState: "NEEDS_DETAILS" } });
    if (!created.ok) throw new Error("Capture was not created.");

    db.signedIn = false;
    const denied = await updateCaptureAction({ id: created.data.id, text: "Must not be stored.", canonicalEmployerUrl: "" });
    expect(denied).toMatchObject({ ok: false, error: expect.any(String) });
    expect(await prisma().capture.findUniqueOrThrow({ where: { id: created.data.id } })).toMatchObject({ text: "", ingestionState: "NEEDS_DETAILS" });

    db.signedIn = true;
    const updated = await updateCaptureAction({ id: created.data.id, text: "Official posting text", canonicalEmployerUrl: "" });
    expect(updated).toMatchObject({ ok: true, data: { text: "Official posting text", ingestionState: "READY" } });
    expect(await updateCaptureAction({ id: created.data.id, text: "x".repeat(100_001), canonicalEmployerUrl: "" })).toMatchObject({ ok: false });
    expect(await createCaptureAction({ url: "javascript:alert(1)", clientRequestId: "bad-url" })).toMatchObject({ ok: false });
  });
});
