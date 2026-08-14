/**
 * Counsel sign-off recency. The compliance panel already tells admins to
 * re-record after each legislative session; this makes that copy enforce
 * itself — a review older than a year stops reading as a green check.
 * Pure: `now` is an argument, like every other clock in src/domain.
 */
const MS_DAY = 86_400_000;

export const STATUTE_REVIEW_STALE_DAYS = 365;

/** Days since the recorded review date; null when the date is unparseable. */
export function statuteReviewAgeDays(reviewedOn: string, now: Date): number | null {
  const t = Date.parse(reviewedOn);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / MS_DAY);
}

/**
 * A review is stale once a legislative session has plausibly passed.
 * An unparseable date counts as stale — recency we can't prove is recency
 * we don't claim.
 */
export function statuteReviewIsStale(
  reviewedOn: string,
  now: Date,
  staleDays = STATUTE_REVIEW_STALE_DAYS,
): boolean {
  const age = statuteReviewAgeDays(reviewedOn, now);
  return age === null || age > staleDays;
}
