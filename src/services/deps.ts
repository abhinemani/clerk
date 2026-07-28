/**
 * Service dependencies — the impure edges (clock, id/token generation) are
 * injected so use cases stay deterministic and unit-testable.
 */
import type { Repository } from "./repository";

export interface ServiceDeps {
  repo: Repository;
  now: () => Date;
  genId: () => string;
  genToken: () => string;
}

/** Production defaults: real clock, random UUIDs, url-safe tokens. */
export function defaultDeps(repo: Repository): ServiceDeps {
  return {
    repo,
    now: () => new Date(),
    genId: () => crypto.randomUUID(),
    genToken: () => crypto.randomUUID().replace(/-/g, "").slice(0, 20),
  };
}
