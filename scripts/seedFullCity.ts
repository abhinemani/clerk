/**
 * Seed the configured database with the full demo city: the two base tenants
 * (seedDemoTenants) plus a much larger, historically-spread Riverton dataset
 * (seedFullCity) — more departments, staff, requesters, and ~45 requests
 * covering every request status, for exercising the app like a real office.
 *
 *   npm run seed:full        # seeds ./.pgdata (persistent embedded DB)
 *   DATABASE_URL=... npm run seed:full   # seeds a managed Postgres
 *
 * NEVER run this against a data dir a server currently has open — PGlite is
 * single-writer. For a running container, use SEED_FULL_CITY=true at boot
 * instead. Idempotent: re-running is a no-op once seeded.
 */
import { printCredentials, seedDemoTenants } from "../src/lib/seedDemo";
import { seedFullCity } from "../src/lib/seedFullCity";

async function main() {
  const base = await seedDemoTenants();
  const full = await seedFullCity();
  if (!base.seeded && !full.seeded) console.log("Already seeded — nothing to do.");
  printCredentials();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
