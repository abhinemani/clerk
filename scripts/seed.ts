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
import { releaseRequest, reviewDocument } from "../src/services/releaseService";
import { submitRequest, transitionRequest } from "../src/services/requestService";
import { acceptTaskRecords, dispatchTask, startTask, submitTaskRecords } from "../src/services/taskService";

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
  // Wei's request runs the ENTIRE lifecycle in the seed — dispatch, fulfill,
  // review, and a named-approver public release — so the demo opens with a
  // closed request, honest on-time metrics, and a real archive entry.
  const weiRequest = await submitRequest(deps, {
    agencyId,
    rawText: "The current janitorial services contract for City Hall.",
    requester: { email: "wei@example.com", name: "Wei Chen", type: "individual" },
  });
  {
    const repo = deps.repo;
    const admin = (await repo.listUsers(agencyId)).find((u) => u.role === "admin");
    if (!admin) throw new Error("seed: no admin user to approve the demo release");
    const clerkDept = (await repo.listDepartments(agencyId)).find((d) => d.name === "City Clerk");
    await transitionRequest(deps, { agencyId, requestId: weiRequest.id, to: "in_review", actorUserId: admin.id });
    await transitionRequest(deps, { agencyId, requestId: weiRequest.id, to: "in_progress", actorUserId: admin.id });
    const task = await dispatchTask(deps, {
      agencyId,
      requestId: weiRequest.id,
      departmentId: clerkDept?.id,
      departmentName: clerkDept?.name ?? "City Clerk",
      departmentEmail: clerkDept?.defaultResponderEmails[0] ?? "pshah@riverton.gov",
      scopeText: "Pull the active janitorial services contract for City Hall.",
      dueAt: new Date(Date.now() + 3 * 86_400_000),
      actorUserId: admin.id,
    });
    await startTask(deps, agencyId, task.id);
    await submitTaskRecords(deps, {
      agencyId,
      taskId: task.id,
      uploads: [{ name: "janitorial-contract-2025.pdf", pages: 11 }],
    });
    await acceptTaskRecords(deps, { agencyId, taskId: task.id, actorUserId: admin.id });
    const [doc] = await repo.listRequestDocuments(agencyId, weiRequest.id);
    if (doc) {
      await reviewDocument(deps, {
        agencyId,
        requestId: weiRequest.id,
        documentId: doc.id,
        decision: "release",
        actorUserId: admin.id,
      });
      await releaseRequest(deps, {
        agencyId,
        requestId: weiRequest.id,
        actorUserId: admin.id,
        visibility: "public",
        archiveTitle: "City Hall Janitorial Services Contract (2025)",
        archiveSummary: "The active janitorial services contract for City Hall, released in full.",
      });
    }
  }
  // Registering with the same email claims the filed request into the account.
  const jordan = await registerRequester(deps, {
    agencyId,
    email: "jordan@rivertonledger.com",
    name: "Jordan Alvarez",
    password: "riverton-resident",
    type: "media",
  });
  // Demo shortcut: mark the claim verified (in real use, Jordan clicks the
  // verification link that lands in the outbox).
  await deps.repo.updateRequester(agencyId, jordan.id, { emailVerifiedAt: new Date() });

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
  const { agency: bellmar, ingestKey: bellmarIngestKey } = await provisionAgency(deps, {
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
  console.log(`Bellmar ingestion API key (shown once): ${bellmarIngestKey}`);
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
