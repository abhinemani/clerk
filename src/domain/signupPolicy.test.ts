/**
 * Signup trust & safety: gov-email LABEL (not a gate — see signupPolicy.ts)
 * + rate limiting, which is the load-bearing guard now that the door is open.
 */
import { describe, expect, it } from "vitest";
import { isGovernmentEmail, SignupRateLimiter } from "./signupPolicy";

describe("isGovernmentEmail", () => {
  it("accepts .gov, .mil, and state/local .us domains", () => {
    for (const good of [
      "clerk@riverton.gov",
      "records@marlin.county.gov",
      "a@navy.mil",
      "clerk@ci.springfield.il.us",
      "records@state.wa.us",
      "UPPER@CITY.GOV",
    ]) {
      expect(isGovernmentEmail(good), good).toBe(true);
    }
  });

  it("does not label anything else — including lookalikes", () => {
    for (const bad of [
      "me@gmail.com",
      "clerk@rivertongov.com", // lookalike, no dot before gov
      "clerk@gov.example.com", // gov not the TLD
      "a@fake.us", // bare .us without the state hierarchy
      "not-an-email",
      "@riverton.gov",
    ]) {
      expect(isGovernmentEmail(bad), bad).toBe(false);
    }
  });

  it("is a label, not an admission test — real offices it under-counts", () => {
    // These are genuine records offices. False here MUST NOT mean refused;
    // signup/actions.ts only blocks them when an operator opts into
    // SIGNUP_REQUIRE_GOV_EMAIL. Documented so nobody re-reads false as "fake".
    for (const realButUnlabelled of [
      "clerk@cityofriverton.org",
      "records@rivertonschools.edu",
      "foia@riverton-transit-authority.com",
      "clerk@riverton.ca", // a jurisdiction outside the .gov namespace
    ]) {
      expect(isGovernmentEmail(realButUnlabelled), realButUnlabelled).toBe(false);
    }
  });
});

describe("SignupRateLimiter", () => {
  const opts = { windowMs: 60_000, maxPerKey: 2, maxGlobal: 4 };

  it("allows up to maxPerKey per window, then refuses", () => {
    const rl = new SignupRateLimiter(opts);
    expect(rl.allow("ip-1", 0)).toBe(true);
    expect(rl.allow("ip-1", 1_000)).toBe(true);
    expect(rl.allow("ip-1", 2_000)).toBe(false); // third in the window
    expect(rl.allow("ip-1", 61_500)).toBe(true); // window rolled
  });

  it("enforces the global cap across keys", () => {
    const rl = new SignupRateLimiter(opts);
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("b", 0)).toBe(true);
    expect(rl.allow("c", 0)).toBe(true);
    expect(rl.allow("d", 0)).toBe(true);
    expect(rl.allow("e", 0)).toBe(false); // 5th signup deployment-wide
  });
});
