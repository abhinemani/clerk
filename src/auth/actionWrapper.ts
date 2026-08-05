/**
 * The one shape every staff server action shares: re-derive the actor from
 * the session (the UI is not the security boundary), build service deps, run
 * the use case, and translate failures — known domain errors surface their
 * message verbatim; anything else is logged and replaced with a safe
 * fallback so internals never leak into the UI.
 *
 * The auth guard runs OUTSIDE the try block on purpose: requireStaff
 * redirects by throwing Next's control-flow error, and catching that would
 * break every redirect. Only the use case itself is error-translated.
 *
 * Adoption is incremental by design — new actions use this; existing ones
 * convert as they're touched.
 */
import { requireStaff, type StaffSession } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { defaultDeps, type ServiceDeps } from "@/services/deps";
import type { Repository, StaffRole } from "@/services/repository";

export interface StaffActionCtx {
  staff: StaffSession;
  repo: Repository;
  deps: ServiceDeps;
  agencySlug: string;
}

type ErrorClass = new (...args: never[]) => Error;

export interface StaffActionOpts {
  /** Role gate, passed straight to requireStaff (omit = coordinator+, responders denied). */
  roles?: StaffRole[];
  /** What the user sees when an UNKNOWN error escapes the use case. */
  fallback: string;
  /** Domain error classes whose .message is safe to show verbatim. */
  exposes?: ErrorClass[];
}

/**
 * Wrap a staff server action. The returned function keeps the
 * (agencySlug, ...args) calling convention every action already uses, and
 * widens the result with the `{ ok: false; error }` failure arm.
 */
export function staffAction<A extends unknown[], R>(
  opts: StaffActionOpts,
  fn: (ctx: StaffActionCtx, ...args: A) => Promise<R>,
): (agencySlug: string, ...args: A) => Promise<R | { ok: false; error: string }> {
  return async (agencySlug: string, ...args: A) => {
    const staff = await requireStaff(agencySlug, opts.roles); // outside try — redirects must throw
    try {
      const repo = await getRepository();
      return await fn({ staff, repo, deps: defaultDeps(repo), agencySlug }, ...args);
    } catch (e) {
      if (opts.exposes?.some((C) => e instanceof C)) {
        return { ok: false, error: (e as Error).message };
      }
      console.error(`[action] ${fn.name || "staff action"} failed (${agencySlug})`, e);
      return { ok: false, error: opts.fallback };
    }
  };
}
