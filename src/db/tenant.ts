/**
 * Tenant isolation helpers (spec §3, §10).
 *
 * "Tenancy is a first-class column (agency_id) on every table with row-level
 *  enforcement in the data layer." Every query that touches a domain table must
 *  filter by agencyId; these helpers make that predicate mandatory and hard to
 *  forget — the agency scope is always ANDed in, and a missing/blank agencyId
 *  throws rather than silently returning cross-tenant rows.
 *
 * Full cross-agency integration tests (a read scoped to agency A must never see
 * agency B's rows) run against a live Postgres in the §10 test suite; the unit
 * tests here cover the guard logic itself.
 */
import { and, eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Throw unless `agencyId` is a syntactically valid, non-blank tenant id. */
export function requireAgencyId(agencyId: string | null | undefined): string {
  if (!agencyId || typeof agencyId !== "string" || !UUID_RE.test(agencyId)) {
    throw new TenantScopeError(
      `A valid agencyId is required for every tenant-scoped query (got ${JSON.stringify(agencyId)}).`,
    );
  }
  return agencyId;
}

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

/**
 * Build a WHERE condition that is ALWAYS scoped to a single agency, optionally
 * ANDed with additional conditions. The agency predicate can never be omitted:
 * callers pass the tenant column and id, and the extra conditions are folded in.
 */
export function tenantWhere(
  agencyColumn: AnyPgColumn,
  agencyId: string | null | undefined,
  ...extra: (SQL | undefined)[]
): SQL {
  const id = requireAgencyId(agencyId);
  const conditions = [eq(agencyColumn, id), ...extra.filter((c): c is SQL => c !== undefined)];
  // `and` of a single condition returns that condition; with more it ANDs them.
  return (conditions.length === 1 ? conditions[0] : and(...conditions)) as SQL;
}
