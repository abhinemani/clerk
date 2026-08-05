/** Signup trust & safety: gov-email gate + rate limiting. */
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

  it("rejects everything else — including lookalikes", () => {
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
