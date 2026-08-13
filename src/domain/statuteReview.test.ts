import { describe, expect, it } from "vitest";
import { statuteReviewAgeDays, statuteReviewIsStale } from "./statuteReview";

const NOW = new Date("2026-08-13T12:00:00Z");

describe("statuteReviewAgeDays", () => {
  it("counts whole days since the review", () => {
    expect(statuteReviewAgeDays("2026-07-01", NOW)).toBe(43);
  });
  it("returns null for garbage", () => {
    expect(statuteReviewAgeDays("not-a-date", NOW)).toBeNull();
  });
});

describe("statuteReviewIsStale", () => {
  it("fresh review is not stale", () => {
    expect(statuteReviewIsStale("2026-07-01", NOW)).toBe(false);
  });
  it("a review over a year old is stale", () => {
    expect(statuteReviewIsStale("2025-06-01", NOW)).toBe(true);
  });
  it("exactly a year old is still fresh (stale means OVER the window)", () => {
    expect(statuteReviewIsStale("2025-08-13", NOW)).toBe(false);
  });
  it("an unparseable date is stale — recency we can't prove", () => {
    expect(statuteReviewIsStale("??", NOW)).toBe(true);
  });
});
