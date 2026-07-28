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
import { defaultDeps, type ServiceDeps } from "../src/services/deps";
import { submitRequest } from "../src/services/requestService";

/** Publish a record to an agency's public archive (classification: public). */
async function publish(
  deps: ServiceDeps,
  agencyId: string,
  externalId: string,
  meta: { title: string; summary: string; tags: string[]; keywords: string[]; releasedOn: string },
) {
  await deps.repo.upsertDocumentByExternalId({
    id: deps.genId(),
    agencyId,
    sourceId: null,
    externalSystemId: externalId,
    filename: `${externalId}.pdf`,
    classification: "public",
    recordType: meta.tags[0] ?? null,
    processingStatus: "ready",
    metadata: meta,
    createdAt: deps.now(),
  });
}

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

  // Riverton's public archive — what the answer box deflects with (§6.7).
  await publish(deps, agencyId, "riverton-acme-paving-2025", {
    title: "Riverton–Acme Paving Contract (2025)",
    summary:
      "Executed street-resurfacing contract with Acme Paving, awarded March 2025, including scope, $1.2M value, and completion schedule.",
    tags: ["contracts", "public works"],
    keywords: ["paving", "acme", "street", "contract", "resurfacing", "road"],
    releasedOn: "2025-03-18",
  });
  await publish(deps, agencyId, "riverton-council-minutes-2024", {
    title: "City Council Minutes — 2024",
    summary: "Complete set of adopted City Council meeting minutes for calendar year 2024.",
    tags: ["minutes", "city clerk"],
    keywords: ["council", "minutes", "meeting", "2024", "agenda", "vote"],
    releasedOn: "2025-01-10",
  });
  await publish(deps, agencyId, "riverton-budget-fy2025", {
    title: "Adopted FY2025 City Budget",
    summary: "The adopted fiscal-year 2025 budget with department allocations and capital projects.",
    tags: ["budget", "finance"],
    keywords: ["budget", "finance", "fiscal", "spending", "allocation", "capital"],
    releasedOn: "2024-11-22",
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
  // Bellmar's own archive — proves tenants never see each other's records.
  await publish(deps, bellmar.id, "bellmar-shoreline-plan-2025", {
    title: "Bellmar Shoreline Master Plan (2025)",
    summary: "The adopted shoreline management plan, including public access and restoration commitments.",
    tags: ["planning", "parks"],
    keywords: ["shoreline", "plan", "waterfront", "parks", "restoration"],
    releasedOn: "2025-06-02",
  });
  await publish(deps, bellmar.id, "bellmar-sheriff-annual-2025", {
    title: "Sheriff's Office Annual Report — 2025",
    summary: "Calls for service, response times, and use-of-force statistics for calendar 2025.",
    tags: ["public safety"],
    keywords: ["sheriff", "police", "annual", "report", "statistics", "response"],
    releasedOn: "2026-02-14",
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
