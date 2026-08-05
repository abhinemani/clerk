/**
 * Self-signup trust & safety (pure).
 *
 * Two guards keep the open /signup honest on a public deployment:
 *
 * 1. GOVERNMENT EMAIL: the admin address must be on a government domain
 *    (.gov, .mil, or the state/local .us hierarchy). This isn't bulletproof
 *    identity-proofing — it's the same bar GitHub/Slack-style gov programs
 *    use, and it stops casual squatting of city names. Self-hosted or demo
 *    deployments loosen it with SIGNUP_ALLOW_ANY_EMAIL=true.
 *
 * 2. RATE LIMIT: a fixed window per client plus a global cap, so a script
 *    can't flood the deployment with tenants. Deterministic (clock injected)
 *    and in-memory — a restart resets it, which for signup is fine.
 */

const GOV_TLD = /\.(gov|mil)$/i;
// state/local .us domains (ci.springfield.il.us, co.marlin.tx.us, state.wa.us …)
const US_HIERARCHY = /\.[a-z]{2}\.us$/i;

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
