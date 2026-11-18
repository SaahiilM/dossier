import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticateMobileRequest: vi.fn(),
  revokeMobileDeviceSession: vi.fn(),
  listMobileApplications: vi.fn(),
  getMobileApplication: vi.fn(),
  getMobileProfile: vi.fn(),
  applyStatusChange: vi.fn(),
  addApplicationNote: vi.fn(),
  updateApplicationNote: vi.fn(),
  deleteApplicationNote: vi.fn(),
}));

vi.mock("@/lib/mobile/device-sessions", () => ({
  authenticateMobileRequest: (...args: unknown[]) => state.authenticateMobileRequest(...args),
  revokeMobileDeviceSession: (...args: unknown[]) => state.revokeMobileDeviceSession(...args),
}));
vi.mock("@/lib/mobile/resources", () => ({
  listMobileApplications: (...args: unknown[]) => state.listMobileApplications(...args),
  getMobileApplication: (...args: unknown[]) => state.getMobileApplication(...args),
  getMobileProfile: (...args: unknown[]) => state.getMobileProfile(...args),
}));
vi.mock("@/lib/status-changes", () => ({ applyStatusChange: (...args: unknown[]) => state.applyStatusChange(...args) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/application-notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/application-notes")>();
  return {
    ...actual,
    addApplicationNote: (...args: unknown[]) => state.addApplicationNote(...args),
    updateApplicationNote: (...args: unknown[]) => state.updateApplicationNote(...args),
    deleteApplicationNote: (...args: unknown[]) => state.deleteApplicationNote(...args),
  };
});

import { POST as logout } from "./auth/logout/route";
import { GET as applications } from "./applications/route";
import { GET as applicationDetail, PATCH as patchApplication } from "./applications/[id]/route";
import { POST as addApplicationNote } from "./applications/[id]/notes/route";
import { DELETE as deleteApplicationNote, PATCH as patchApplicationNote } from "./applications/[id]/notes/[noteId]/route";
import { GET as profile } from "./profile/route";

const bearer = new Request("https://dossier.test/api/mobile/v1/applications", {
  headers: { authorization: `Bearer ${"A".repeat(43)}` },
});

describe("mobile protected routes", () => {
  beforeEach(() => {
    state.authenticateMobileRequest.mockReset().mockResolvedValue({ id: "session-1", deviceName: "Test phone", expiresAt: new Date("2026-12-17T00:00:00.000Z") });
    state.revokeMobileDeviceSession.mockReset().mockResolvedValue(undefined);
    state.listMobileApplications.mockReset().mockResolvedValue({ items: [], nextCursor: null });
    state.getMobileApplication.mockReset().mockResolvedValue(null);
    state.getMobileProfile.mockReset().mockResolvedValue({ basics: { name: "Test User" } });
    state.applyStatusChange.mockReset().mockResolvedValue({ outcome: "changed" });
    state.addApplicationNote.mockReset().mockResolvedValue({
      id: "note-1", body: "Called John.", createdAt: new Date("2026-11-17T12:00:00.000Z"), updatedAt: new Date("2026-11-17T12:00:00.000Z"),
    });
    state.updateApplicationNote.mockReset().mockResolvedValue({
      outcome: "saved", note: { id: "note-1", body: "Called John again.", createdAt: new Date("2026-11-17T12:00:00.000Z"), updatedAt: new Date("2026-11-17T13:00:00.000Z") },
    });
    state.deleteApplicationNote.mockReset().mockResolvedValue({ outcome: "deleted", note: { id: "note-1" } });
  });

  it("does not accept a web cookie in place of a bearer token", async () => {
    state.authenticateMobileRequest.mockResolvedValue(null);
    const cookieOnly = new Request("https://dossier.test/api/mobile/v1/applications", {
      headers: { cookie: "dossier_session=valid-web-session" },
    });
    const response = await applications(cookieOnly);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "unauthorized", message: "Sign in to continue." } });
    expect(state.listMobileApplications).not.toHaveBeenCalled();

    const jsonHeaders = { cookie: "dossier_session=valid-web-session", "content-type": "application/json" };
    const appPatch = await patchApplication(new Request("https://dossier.test/api/mobile/v1/applications/app-1", {
      method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ expectedUpdatedAt: "2026-11-17T12:00:00.000Z", status: "SENT" }),
    }), { params: Promise.resolve({ id: "app-1" }) });
    const noteCreate = await addApplicationNote(new Request("https://dossier.test/api/mobile/v1/applications/app-1/notes", {
      method: "POST", headers: jsonHeaders, body: JSON.stringify({ body: "A note" }),
    }), { params: Promise.resolve({ id: "app-1" }) });
    expect(appPatch.status).toBe(401);
    expect(noteCreate.status).toBe(401);
    expect(state.applyStatusChange).not.toHaveBeenCalled();
    expect(state.addApplicationNote).not.toHaveBeenCalled();
  });

  it("returns the cursor envelope for the authenticated list", async () => {
    state.listMobileApplications.mockResolvedValue({ items: [{ id: "app-1" }], nextCursor: "eyJ2ZXJzaW9uIjoxfQ" });
    const response = await applications(bearer);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [{ id: "app-1" }], nextCursor: "eyJ2ZXJzaW9uIjoxfQ" });
  });

  it("rejects duplicate query cursors", async () => {
    const duplicate = new Request("https://dossier.test/api/mobile/v1/applications?cursor=a&cursor=b", { headers: bearer.headers });
    const response = await applications(duplicate);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect(state.listMobileApplications).not.toHaveBeenCalled();
  });

  it("returns 404 for unavailable detail and the DTO envelope for a found record", async () => {
    const context = { params: Promise.resolve({ id: "app-1" }) };
    const missing = await applicationDetail(bearer, context);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "not_found" } });

    state.getMobileApplication.mockResolvedValue({ id: "app-1", status: "DRAFT" });
    const found = await applicationDetail(bearer, context);
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ application: { id: "app-1", status: "DRAFT" } });
  });

  it("version-checks application status changes and returns the full updated detail", async () => {
    const expectedUpdatedAt = "2026-11-17T12:00:00.000Z";
    state.getMobileApplication.mockResolvedValue({ id: "app-1", status: "INTERVIEW", notes: [{ id: "note-1", body: "Called John." }] });
    const response = await patchApplication(new Request("https://dossier.test/api/mobile/v1/applications/app-1", {
      method: "PATCH",
      headers: { ...Object.fromEntries(bearer.headers), "content-type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt, status: "INTERVIEW" }),
    }), { params: Promise.resolve({ id: "app-1" }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ application: { id: "app-1", status: "INTERVIEW", notes: [{ id: "note-1", body: "Called John." }] } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.applyStatusChange).toHaveBeenCalledWith(expect.anything(), "app-1", "INTERVIEW", expect.any(Date), new Date(expectedUpdatedAt));
    expect(state.getMobileApplication).toHaveBeenCalledWith("app-1");
  });

  it("maps stale and missing application status writes to 409 and 404", async () => {
    const makeRequest = () => new Request("https://dossier.test/api/mobile/v1/applications/app-1", {
      method: "PATCH",
      headers: { ...Object.fromEntries(bearer.headers), "content-type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: "2026-11-17T12:00:00.000Z", status: "SENT" }),
    });
    state.applyStatusChange.mockResolvedValueOnce({ outcome: "conflict" });
    expect((await patchApplication(makeRequest(), { params: Promise.resolve({ id: "app-1" }) })).status).toBe(409);
    state.applyStatusChange.mockResolvedValueOnce({ outcome: "not-found" });
    expect((await patchApplication(makeRequest(), { params: Promise.resolve({ id: "app-1" }) })).status).toBe(404);
    expect(state.getMobileApplication).not.toHaveBeenCalled();
  });

  it("creates, edits, and deletes private notes through their scoped versioned endpoints", async () => {
    const collection = "https://dossier.test/api/mobile/v1/applications/app-1/notes";
    const created = await addApplicationNote(new Request(collection, {
      method: "POST", headers: { ...Object.fromEntries(bearer.headers), "content-type": "application/json" }, body: JSON.stringify({ body: "  Called John.  " }),
    }), { params: Promise.resolve({ id: "app-1" }) });
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ note: { id: "note-1", body: "Called John.", createdAt: "2026-11-17T12:00:00.000Z", updatedAt: "2026-11-17T12:00:00.000Z" } });
    expect(state.addApplicationNote).toHaveBeenCalledWith("app-1", "Called John.", { mobileVisibleOnly: true });

    const expectedUpdatedAt = "2026-11-17T12:00:00.000Z";
    const itemUrl = `${collection}/note-1`;
    const patched = await patchApplicationNote(new Request(itemUrl, {
      method: "PATCH", headers: { ...Object.fromEntries(bearer.headers), "content-type": "application/json" },
      body: JSON.stringify({ body: "Called John again.", expectedUpdatedAt }),
    }), { params: Promise.resolve({ id: "app-1", noteId: "note-1" }) });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toEqual({ note: { id: "note-1", body: "Called John again.", createdAt: expectedUpdatedAt, updatedAt: "2026-11-17T13:00:00.000Z" } });
    expect(state.updateApplicationNote).toHaveBeenCalledWith({ applicationId: "app-1", noteId: "note-1", body: "Called John again.", expectedUpdatedAt: new Date(expectedUpdatedAt), mobileVisibleOnly: true });

    const removed = await deleteApplicationNote(new Request(itemUrl, {
      method: "DELETE", headers: { ...Object.fromEntries(bearer.headers), "content-type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt }),
    }), { params: Promise.resolve({ id: "app-1", noteId: "note-1" }) });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });
    expect(state.deleteApplicationNote).toHaveBeenCalledWith({ applicationId: "app-1", noteId: "note-1", expectedUpdatedAt: new Date(expectedUpdatedAt), mobileVisibleOnly: true });
  });

  it("rejects malformed note bodies and reports stale note writes as conflicts", async () => {
    const url = "https://dossier.test/api/mobile/v1/applications/app-1/notes/note-1";
    const stale = await patchApplicationNote(new Request(url, {
      method: "PATCH", headers: { ...Object.fromEntries(bearer.headers), "content-type": "application/json" },
      body: JSON.stringify({ body: " ", expectedUpdatedAt: "2026-11-17T12:00:00.000Z" }),
    }), { params: Promise.resolve({ id: "app-1", noteId: "note-1" }) });
    expect(stale.status).toBe(400);
    expect(state.updateApplicationNote).not.toHaveBeenCalled();

    state.updateApplicationNote.mockResolvedValue({ outcome: "conflict" });
    const response = await patchApplicationNote(new Request(url, {
      method: "PATCH", headers: { ...Object.fromEntries(bearer.headers), "content-type": "application/json" },
      body: JSON.stringify({ body: "Updated", expectedUpdatedAt: "2026-11-17T12:00:00.000Z" }),
    }), { params: Promise.resolve({ id: "app-1", noteId: "note-1" }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "conflict" } });

    state.updateApplicationNote.mockResolvedValue({ outcome: "not-found" });
    const missing = await patchApplicationNote(new Request(url, {
      method: "PATCH", headers: { ...Object.fromEntries(bearer.headers), "content-type": "application/json" },
      body: JSON.stringify({ body: "Updated", expectedUpdatedAt: "2026-11-17T12:00:00.000Z" }),
    }), { params: Promise.resolve({ id: "app-1", noteId: "note-1" }) });
    expect(missing.status).toBe(404);
  });

  it("returns the profile envelope and revokes the authenticated device on logout", async () => {
    const profileResponse = await profile(new Request("https://dossier.test/api/mobile/v1/profile", { headers: bearer.headers }));
    expect(profileResponse.status).toBe(200);
    expect(await profileResponse.json()).toEqual({ profile: { basics: { name: "Test User" } } });

    const logoutRequest = new Request("https://dossier.test/api/mobile/v1/auth/logout", {
      method: "POST",
      headers: bearer.headers,
    });
    const logoutResponse = await logout(logoutRequest);
    expect(logoutResponse.status).toBe(200);
    expect(await logoutResponse.json()).toEqual({ ok: true });
    expect(state.revokeMobileDeviceSession).toHaveBeenCalledWith("session-1");
  });

  it("rejects logout bodies and does not revoke a session", async () => {
    const request = new Request("https://dossier.test/api/mobile/v1/auth/logout", {
      method: "POST",
      headers: { ...Object.fromEntries(bearer.headers), "content-type": "application/json" },
      body: "{}",
    });
    const response = await logout(request);

    expect(response.status).toBe(400);
    expect(state.revokeMobileDeviceSession).not.toHaveBeenCalled();
  });
});
