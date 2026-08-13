/**
 * Credential-attempt throttling — a sliding window per principal
 * (kind + agency + email). 5 failures in 15 minutes locks that principal out
 * until the window drains. In-memory on globalThis (survives Next's per-route
 * bundles; resets on process restart, which is acceptable for a lockout).
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

interface ThrottleGlobal {
  __holmesLoginFailures?: Map<string, number[]>;
}
const g = globalThis as ThrottleGlobal;

function failures(): Map<string, number[]> {
  if (!g.__holmesLoginFailures) g.__holmesLoginFailures = new Map();
  return g.__holmesLoginFailures;
}

const keyFor = (kind: string, agencySlug: string, email: string) =>
  `${kind}:${agencySlug}:${email.trim().toLowerCase()}`;

/** True when this principal has burned its attempts — check BEFORE verifying. */
export function isLockedOut(kind: string, agencySlug: string, email: string, now = Date.now()): boolean {
  const key = keyFor(kind, agencySlug, email);
  const recent = (failures().get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  failures().set(key, recent);
  return recent.length >= MAX_FAILURES;
}

export function recordFailure(kind: string, agencySlug: string, email: string, now = Date.now()): void {
  const key = keyFor(kind, agencySlug, email);
  const recent = (failures().get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  failures().set(key, recent);
}

export function clearFailures(kind: string, agencySlug: string, email: string): void {
  failures().delete(keyFor(kind, agencySlug, email));
}
