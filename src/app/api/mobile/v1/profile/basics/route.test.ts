import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "./route";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), read: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/mobile/device-sessions", () => ({ authenticateMobileRequest: mocks.authenticate }));
vi.mock("@/lib/profile-basics", async (original) => ({
  ...await original<typeof import("@/lib/profile-basics")>(),
  readProfileBasics: mocks.read,
  patchProfileBasics: mocks.patch,
}));

const url = "https://dossier.example/api/mobile/v1/profile/basics";
const mutation = (body: object) => new Request(url, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ id: "device" });
  mocks.patch.mockResolvedValue({ name: "Jane Doe", headline: "Engineer" });
});

describe("mobile profile basics", () => {
  it("requires bearer authentication for reads and writes", async () => {
    mocks.authenticate.mockResolvedValue(null);
    expect((await GET(new Request(url))).status).toBe(401);
    expect((await PATCH(mutation({ name: "Jane Doe" }))).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("writes only supplied fields and returns the current basics", async () => {
    const response = await PATCH(mutation({ name: "Jane Doe" }));
    expect(response.status).toBe(200);
    expect(mocks.patch).toHaveBeenCalledWith({ name: "Jane Doe" });
    expect(await response.json()).toEqual({ basics: { name: "Jane Doe", headline: "Engineer" } });
  });

  it("reads the same default profile as the v1 profile detail route", async () => {
    const response = await GET(new Request(url));

    expect(response.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith();
  });

  it("rejects empty, unknown, and invalid fields", async () => {
    for (const input of [{}, { role: "Engineer" }, { dob: "yesterday" }]) {
      expect((await PATCH(mutation(input))).status).toBe(400);
    }
    expect(mocks.patch).not.toHaveBeenCalled();
  });
});
