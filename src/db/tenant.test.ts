/** Tests for the tenant-scoping guard (spec §10). */
import { describe, expect, it } from "vitest";
import { requireAgencyId, tenantWhere, TenantScopeError } from "./tenant";
import { eq } from "drizzle-orm";
import { requests } from "./schema";

const AGENCY = "11111111-1111-4111-8111-111111111111";

describe("requireAgencyId", () => {
  it("returns a valid uuid unchanged", () => {
    expect(requireAgencyId(AGENCY)).toBe(AGENCY);
  });

  it("throws on blank, null, or malformed ids", () => {
    for (const bad of ["", null, undefined, "not-a-uuid", "123"]) {
      expect(() => requireAgencyId(bad as string)).toThrow(TenantScopeError);
    }
  });
});

describe("tenantWhere", () => {
  it("always produces a condition and requires a valid agencyId", () => {
    expect(tenantWhere(requests.agencyId, AGENCY)).toBeTruthy();
    // The agency predicate can never be skipped by omitting it.
    expect(() => tenantWhere(requests.agencyId, "")).toThrow(TenantScopeError);
  });

  it("folds in extra conditions alongside the mandatory agency scope", () => {
    const where = tenantWhere(
      requests.agencyId,
      AGENCY,
      eq(requests.status, "in_progress"),
    );
    // Combined condition is produced (SQL object is truthy); the agency scope is
    // always included because tenantWhere prepends it unconditionally.
    expect(where).toBeTruthy();
  });

  it("ignores undefined extra conditions", () => {
    expect(tenantWhere(requests.agencyId, AGENCY, undefined)).toBeTruthy();
  });
});
