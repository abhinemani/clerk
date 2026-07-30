/**
 * Seed the configured database (PGlite by default, or DATABASE_URL) with two
 * demo tenants — thin CLI over src/lib/seedDemo.ts.
 *
 *   npm run seed          # seeds ./.pgdata (persistent embedded DB)
 *   DATABASE_URL=... npm run seed   # seeds a managed Postgres
 *
 * NEVER run this against a data dir a server currently has open — PGlite is
 * single-writer. For a running container, use SEED_DEMO=true at boot instead.
 * Idempotent: re-running is a no-op once seeded.
 */
import { printCredentials, seedDemoTenants } from "../src/lib/seedDemo";

async function main() {
  const { seeded } = await seedDemoTenants();
  if (!seeded) console.log("Already seeded — nothing to do.");
  printCredentials();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
