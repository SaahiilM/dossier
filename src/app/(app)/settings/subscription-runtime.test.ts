import { beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({ isDesktopApp: vi.fn(() => false) }));
vi.mock("@/lib/desktop", () => ({ isDesktopApp: desktop.isDesktopApp }));

const envMock = vi.hoisted(() => ({ DOSSIER_PUBLIC_URL: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({ env: envMock }));

const { isSubscriptionAuthRuntime } = await import("./subscription-runtime");

describe("subscription runtime", () => {
  beforeEach(() => {
    desktop.isDesktopApp.mockReturnValue(false);
    envMock.DOSSIER_PUBLIC_URL = undefined;
    delete process.env.DOSSIER_SUBSCRIPTION_LOOPBACK;
  });

  it("accepts desktop token launches", () => {
    desktop.isDesktopApp.mockReturnValue(true);
    expect(isSubscriptionAuthRuntime()).toBe(true);
  });

  it("accepts loopback public URLs and explicit opt-in", () => {
    envMock.DOSSIER_PUBLIC_URL = "http://127.0.0.1:3000";
    expect(isSubscriptionAuthRuntime()).toBe(true);
    envMock.DOSSIER_PUBLIC_URL = "https://dossier.example.com";
    expect(isSubscriptionAuthRuntime()).toBe(false);
    process.env.DOSSIER_SUBSCRIPTION_LOOPBACK = "1";
    expect(isSubscriptionAuthRuntime()).toBe(true);
  });
});
