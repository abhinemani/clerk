import { describe, expect, it } from "vitest";
import { DEV_PLATFORM_ADMIN, resolvePlatformAdmin } from "./platformAdmin";

describe("resolvePlatformAdmin", () => {
  it("uses env credentials when both are set", () => {
    const creds = resolvePlatformAdmin({
      PLATFORM_ADMIN_EMAIL: "ops@example.gov",
      PLATFORM_ADMIN_PASSWORD: "a-real-secret",
      NODE_ENV: "production",
    });
    expect(creds).toEqual({ email: "ops@example.gov", password: "a-real-secret" });
  });

  it("falls back to the printed dev defaults outside production", () => {
    expect(resolvePlatformAdmin({ NODE_ENV: "development" })).toEqual(DEV_PLATFORM_ADMIN);
    expect(resolvePlatformAdmin({ NODE_ENV: "test" })).toEqual(DEV_PLATFORM_ADMIN);
  });

  it("disables platform sign-in in production when env creds are missing", () => {
    // The dev defaults are public knowledge — they must never authenticate
    // the one cross-tenant principal on a real deployment.
    expect(resolvePlatformAdmin({ NODE_ENV: "production" })).toBeNull();
  });

  it("treats a half-set pair as unset in production", () => {
    expect(
      resolvePlatformAdmin({ PLATFORM_ADMIN_EMAIL: "ops@example.gov", NODE_ENV: "production" }),
    ).toBeNull();
    expect(
      resolvePlatformAdmin({ PLATFORM_ADMIN_PASSWORD: "a-real-secret", NODE_ENV: "production" }),
    ).toBeNull();
  });
});
