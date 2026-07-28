/**
 * Seed the configured database (PGlite by default, or DATABASE_URL) with two
 * demo tenants, so the app runs on real persistence and shows multi-tenancy:
 *
 *   City of Riverton (CA) — /riverton — full demo (departments, requests)
 *   City of Bellmar  (WA) — /bellmar  — second tenant, different statute clock
 *
 *   npm run seed          # seeds ./.pgdata (persistent embedded DB)
 *   DATABASE_URL=... npm run seed   # seeds a managed Postgres
 *
 * Idempotent: re-running is a no-op once seeded. Demo credentials print below.
 */
import { getDb, getRepository } from "../src/db/createRepository";
import { departments } from "../src/db/schema";
import { ensureAgency } from "../src/lib/bootstrap";
import { provisionAgency, registerRequester } from "../src/services/accountService";
import { defaultDeps } from "../src/services/deps";
import { submitRequest } from "../src/services/requestService";

async function main() {
  const { agencyId, created } = await ensureAgency();
  if (!created) {
    console.log("Already seeded — nothing to do.");
    printCredentials();
    process.exit(0);
  }

  const deps = defaultDeps(await getRepository());

  // Riverton: two requests + a registered resident who owns the first one.
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
  // Registering with the same email claims the filed request into the account.
  await registerRequester(deps, {
    agencyId,
    email: "jordan@rivertonledger.com",
    name: "Jordan Alvarez",
    password: "riverton-resident",
    type: "media",
  });

  // Bellmar: a second tenant on the same deployment (WA statute profile).
  const { agency: bellmar } = await provisionAgency(deps, {
    name: "City of Bellmar",
    slug: "bellmar",
    stateCode: "WA",
    admin: { name: "Amara Holt", email: "amara@bellmar.gov", password: "bellmar-demo" },
  });
  const db = await getDb();
  await db.insert(departments).values([
    { agencyId: bellmar.id, name: "Parks & Recreation", defaultResponderEmails: ["parks@bellmar.gov"] },
    { agencyId: bellmar.id, name: "Sheriff Records", defaultResponderEmails: ["records@bellmar.gov"] },
  ]);
  await submitRequest(deps, {
    agencyId: bellmar.id,
    rawText: "2026 park maintenance contracts and vendor invoices.",
    requester: { name: "Bellmar Gazette", type: "media" },
  });

  console.log("Seeded City of Riverton (/riverton) and City of Bellmar (/bellmar).");
  printCredentials();
  process.exit(0);
}

function printCredentials() {
  console.log(`
Demo credentials
  Riverton staff admin   /riverton/app/login   dana@riverton.gov / riverton-demo
  Riverton resident      /riverton/login       jordan@rivertonledger.com / riverton-resident
  Bellmar staff admin    /bellmar/app/login    amara@bellmar.gov / bellmar-demo
  Platform operator      /admin/login          admin@clerk.example / clerk-admin-dev
                         (override with PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
