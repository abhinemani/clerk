/**
 * Seed the configured database (PGlite by default, or DATABASE_URL) with the
 * "City of Riverton" demo agency, so the app runs on real persistence.
 *
 *   npm run seed          # seeds ./.pgdata (persistent embedded DB)
 *   DATABASE_URL=... npm run seed   # seeds a managed Postgres
 *
 * Idempotent: re-running is a no-op once seeded.
 */
import { getRepository } from "../src/db/createRepository";
import { ensureAgency } from "../src/lib/bootstrap";
import { defaultDeps } from "../src/services/deps";
import { submitRequest } from "../src/services/requestService";

async function main() {
  const { agencyId, created } = await ensureAgency();
  if (!created) {
    console.log("Already seeded — nothing to do.");
    process.exit(0);
  }

  const deps = defaultDeps(await getRepository());
  await submitRequest(deps, {
    agencyId,
    rawText: "All inspection reports for 400 Main St from January 2024 to present.",
    requester: { email: "jordan@rivertonledger.com", name: "Jordan Alvarez", type: "media" },
  });
  await submitRequest(deps, {
    agencyId,
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
