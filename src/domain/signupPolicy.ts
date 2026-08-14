/**
 * Self-signup trust & safety (pure).
 *
 * GOVERNMENT EMAIL IS A SIGNAL, NOT A GATE (2026-08-14). It used to be a
 * hard requirement, which was wrong: plenty of real records officers work
 * from a `@cityofx.org`, a joint-powers authority domain, a school district,
 * a library, a tribal government, or a personal address while their IT
 * department catches up. Turning those people away at the door is a worse
 * failure than letting a stranger create a tenant that an operator can see
 * and delete. So anyone may register; `isGovernmentEmail` now only labels
 * the signup in the audit trail (and lets an operator who wants the old
 * strict door set SIGNUP_REQUIRE_GOV_EMAIL=true).
 *
 * What actually guards the open door:
 *
 * 1. RATE LIMIT: a fixed window per client plus a global cap, so a script
 *    can't flood the deployment with tenants. Deterministic (clock injected)
 *    and in-memory — a restart resets it, which for signup is fine.
 *
 * 2. VISIBILITY: every self-signup lands in the append-only admin event log
 *    saying it was self-service and whether the admin address was on a
 *    government domain, so the operator console shows who walked in.
 *
 * 3. Tenants are isolated from row one (invariant 2), so a junk tenant is
 *    junk in its own box — it can't see or touch anyone else's records.
 */

const GOV_TLD = /\.(gov|mil)$/i;
// state/local .us domains (ci.springfield.il.us, co.marlin.tx.us, state.wa.us …)
const US_HIERARCHY = /\.[a-z]{2}\.us$/i;

/**
 * True for .gov, .mil, and the state/local .us hierarchy. Used to LABEL a
 * signup, not to admit it — a false result is not a reason to refuse anyone
 * (see the module header). Deliberately conservative: it under-counts real
 * governments (`@cityofx.org`) rather than over-counting lookalikes.
 */
export function isGovernmentEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 1) return false; // needs a non-empty local part
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain || domain.includes(" ")) return false;
  return GOV_TLD.test(domain) || US_HIERARCHY.test(domain);
}

export interface RateLimiterOptions {
  windowMs: number;
  maxPerKey: number;
  maxGlobal: number;
}

/** Fixed-window limiter; prune-on-check keeps memory bounded. */
export class SignupRateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly opts: RateLimiterOptions) {}

  /** Record + check in one step. Returns true when the attempt is allowed. */
  allow(key: string, now: number): boolean {
    const cutoff = now - this.opts.windowMs;
    for (const [k, times] of this.hits) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length === 0) this.hits.delete(k);
      else this.hits.set(k, kept);
    }
    const mine = this.hits.get(key) ?? [];
    const global = [...this.hits.values()].reduce((n, t) => n + t.length, 0);
    if (mine.length >= this.opts.maxPerKey || global >= this.opts.maxGlobal) return false;
    mine.push(now);
    this.hits.set(key, mine);
    return true;
  }
}
