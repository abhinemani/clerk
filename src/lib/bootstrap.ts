/**
 * Demo-agency bootstrap — the one place that creates "City of Riverton"
 * (agency + coordinator + departments) in the configured database.
 *
 * Used by both `npm run seed` and the portal's file-a-request action, so a
 * fresh clone works turnkey: the first filed request creates the agency if the
 * operator never ran the seed. Idempotent — keyed on the fixed agency UUID/slug.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db/createRepository";
import { agencies, departments, users } from "@/db/schema";

export const AGENCY_SLUG = "riverton";
export const AGENCY_ID = "a0000000-0000-4000-8000-000000000001";
export const COORDINATOR_ID = "a0000000-0000-4000-8000-000000000002";

/** Ensure the demo agency exists; returns its id. Safe to call on every request. */
export async function ensureAgency(): Promise<{ agencyId: string; created: boolean }> {
  const db = await getDb();

  const [existing] = await db.select().from(agencies).where(eq(agencies.slug, AGENCY_SLUG)).limit(1);
  if (existing) return { agencyId: existing.id, created: false };

  await db.insert(agencies).values({
    id: AGENCY_ID,
    slug: AGENCY_SLUG,
    name: "City of Riverton",
    stateCode: "CA",
    observedHolidays: [],
  });
  await db.insert(users).values({
    id: COORDINATOR_ID,
    agencyId: AGENCY_ID,
    email: "dana@riverton.gov",
    name: "Dana Okafor",
    role: "coordinator",
  });
  await db.insert(departments).values([
    { agencyId: AGENCY_ID, name: "Public Works", defaultResponderEmails: ["mbell@riverton.gov"] },
    { agencyId: AGENCY_ID, name: "Police Records", defaultResponderEmails: ["rvann@riverton.gov"] },
    { agencyId: AGENCY_ID, name: "City Clerk", defaultResponderEmails: ["pshah@riverton.gov"] },
  ]);
  return { agencyId: AGENCY_ID, created: true };
}
