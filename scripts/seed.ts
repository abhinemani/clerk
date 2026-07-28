/**
 * Seed the configured database (PGlite by default, or DATABASE_URL) with the
 * "City of Riverton" demo agency, so the app runs on real persistence.
 *
 *   npm run seed          # seeds ./.pgdata (persistent embedded DB)
 *   DATABASE_URL=... npm run seed   # seeds a managed Postgres
 *
 * Idempotent: re-running is a no-op once seeded.
 */
import { eq } from "drizzle-orm";
import { getDb, getRepository } from "../src/db/createRepository";
import { agencies, departments, users } from "../src/db/schema";
import { defaultDeps } from "../src/services/deps";
import { submitRequest } from "../src/services/requestService";

const AGENCY_ID = "a0000000-0000-4000-8000-000000000001";
const COORDINATOR_ID = "a0000000-0000-4000-8000-000000000002";

async function main() {
  const db = await getDb();

  const existing = await db.select().from(agencies).where(eq(agencies.slug, "riverton")).limit(1);
  if (existing.length) {
    console.log("Already seeded — nothing to do.");
    process.exit(0);
  }

  await db.insert(agencies).values({
    id: AGENCY_ID,
    slug: "riverton",
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

  const deps = defaultDeps(await getRepository());
  await submitRequest(deps, {
    agencyId: AGENCY_ID,
    rawText: "All inspection reports for 400 Main St from January 2024 to present.",
    requester: { email: "jordan@rivertonledger.com", name: "Jordan Alvarez", type: "media" },
  });
  await submitRequest(deps, {
    agencyId: AGENCY_ID,
    rawText: "The current janitorial services contract for City Hall.",
    requester: { name: "Wei Chen", type: "individual" },
  });

  console.log("Seeded City of Riverton (agency, 3 departments, coordinator, 2 requests).");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
