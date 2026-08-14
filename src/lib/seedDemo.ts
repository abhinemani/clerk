/**
 * Demo-tenant seeding as a callable (used by scripts/seed.ts AND the
 * SEED_DEMO=true boot path). Running this in-process at boot is the ONLY safe
 * way to seed a running server: PGlite is single-writer, so a second seeding
 * process against a live server's data dir is corruption roulette.
 *
 * Idempotent: a seeded database returns { seeded: false } untouched.
 */
import { blobKey, checksumOf, getBlobStore } from "@/adapters/blobStore";
import { branding } from "@/config/branding";
import { hashPassword } from "@/auth/passwords";
import { extractText } from "@/adapters/textExtract";
import { getDb, getRepository } from "@/db/createRepository";
import { departments } from "@/db/schema";
import { COORDINATOR_ID, ensureAgency } from "@/lib/bootstrap";
import { REDACTION_DEMO } from "@/lib/redactionDemo";
import { provisionAgency, registerRequester } from "@/services/accountService";
import { defaultDeps, type ServiceDeps } from "@/services/deps";
import { sendStaffMessage } from "@/services/messageService";
import { releaseRequest, reviewDocument } from "@/services/releaseService";
import { submitRequest, transitionRequest } from "@/services/requestService";
import { acceptTaskRecords, dispatchTask, startTask, submitTaskRecords } from "@/services/taskService";

/** A tiny real, openable PDF — so seeded downloads download actual bytes. */
export function demoPdf(title: string): Buffer {
  const text = `BT /F1 16 Tf 72 720 Td (${title.replace(/[()\\]/g, "")}) Tj ET`;
  return Buffer.from(
    [
      "%PDF-1.4",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
      `4 0 obj << /Length ${text.length} >> stream`,
      text,
      "endstream endobj",
      "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
      "trailer << /Root 1 0 R >>",
      "%%EOF",
    ].join("\n"),
    "utf8",
  );
}

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

export async function seedDemoTenants(): Promise<{ seeded: boolean }> {
  const { agencyId, created } = await ensureAgency();
  if (!created) return { seeded: false };

  const deps = defaultDeps(await getRepository());

  // A second coordinator + workflow automation ON for Riverton, so the demo
  // shows requests load-balancing across a real roster (and, with an AI key,
  // high-confidence routing dispatching itself).
  await deps.repo.createUser({
    id: deps.genId(),
    agencyId,
    email: "casey@riverton.gov",
    name: "Casey Trinh",
    role: "coordinator",
    passwordHash: hashPassword("riverton-demo2"),
  });
  // A department responder with a real login (department-scoped accounts):
  // signs in and sees only Public Works' tasks at /riverton/app/tasks.
  const samResponder = await deps.repo.createUser({
    id: deps.genId(),
    agencyId,
    email: "sam@riverton.gov",
    name: "Sam Iyer",
    role: "responder",
    passwordHash: hashPassword("riverton-demo3"),
  });
  await deps.repo.updateAgency(agencyId, {
    workflowSettings: { autoAssign: true, autoDispatch: true, autoDispatchConfidence: 0.85 },
    // Branding demo: the footer contact block renders only what's provided.
    branding: {
      contactEmail: "records@riverton.gov",
      addressLines: ["City Hall, 100 Civic Center Plaza"],
      hours: "Mon–Fri, 8:00 a.m.–5:00 p.m.",
    },
    // Transparency demo: the public request log at /riverton/log, plus a
    // counsel sign-off on the CA statute profile.
    settings: {
      publicRequestLog: true,
      statuteReview: {
        reviewedBy: "M. Chen, City Attorney",
        reviewedOn: "2026-07-01",
        note: "Confirmed against the 2026 legislative session.",
      },
    },
  });
  // Deterministic routing rules — file "pothole repairs on Elm St" in the
  // portal and watch the Public Works task go out with no AI key at all.
  const seedDepts = await deps.repo.listDepartments(agencyId);
  const deptIdByName = new Map(seedDepts.map((d) => [d.name, d.id]));
  const publicWorksId = deptIdByName.get("Public Works");
  if (publicWorksId) await deps.repo.setUserDepartments(agencyId, samResponder.id, [publicWorksId]);
  await deps.repo.updateAgency(agencyId, {
    defaultRoutingRules: [
      { departmentId: deptIdByName.get("Public Works")!, keywords: ["pothole", "paving", "sidewalk", "street light", "inspection"] },
      { departmentId: deptIdByName.get("Police Records")!, keywords: ["police", "incident", "arrest", "accident", "bodycam"] },
      { departmentId: deptIdByName.get("City Clerk")!, keywords: ["contract", "minutes", "ordinance", "budget", "resolution"] },
    ],
  });

  // Referral directory — the agencies Riverton most often points people at.
  // Referral works with zero AI and zero integration: it's contact data.
  for (const entry of [
    {
      name: "Riverton Unified School District",
      jurisdictionType: "school_district" as const,
      contactEmail: "records@rusd.example",
      contactPhone: "(555) 010-2000",
      portalUrl: "https://rusd.example/public-records",
      recordTypes: ["student records", "board minutes", "school police reports"],
      notes: "Student discipline and enrollment files are theirs, not the city's.",
    },
    {
      name: "Riverton County Clerk-Recorder",
      jurisdictionType: "county" as const,
      contactEmail: "publicrecords@rivertoncounty.example",
      contactPhone: "(555) 010-3300",
      portalUrl: "https://rivertoncounty.example/records",
      recordTypes: ["property deeds", "marriage licenses", "election records"],
      notes: null,
    },
    {
      name: "California Department of Justice",
      jurisdictionType: "state" as const,
      contactEmail: "pra@doj.ca.example",
      contactPhone: null,
      portalUrl: "https://oag.ca.example/records",
      recordTypes: ["statewide criminal history", "AB 1421 filings"],
      notes: null,
    },
  ]) {
    await deps.repo.createDirectoryEntry({
      id: deps.genId(),
      agencyId,
      peerAgencyId: null,
      ...entry,
    });
  }

  // Riverton: two requests + a registered resident who owns the first one.
  const jordanRequest = await submitRequest(deps, {
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
    // Real bytes in the blob store — the tracker's Download link serves this.
    const pdf = demoPdf("City of Riverton - Janitorial Services Contract 2025");
    const key = await getBlobStore().put(
      blobKey(agencyId, "janitorial-contract-2025.pdf"),
      pdf,
      "application/pdf",
    );
    await submitTaskRecords(deps, {
      agencyId,
      taskId: task.id,
      uploads: [
        {
          name: "janitorial-contract-2025.pdf",
          pages: 11,
          blobRef: key,
          byteSize: pdf.length,
          mimeType: "application/pdf",
          checksum: checksumOf(pdf),
        },
      ],
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
  // Jordan's request pauses on a clarification — the demo's interactive
  // moment: sign in as Jordan, open the tracker, and reply to resume it.
  {
    const admin = (await deps.repo.listUsers(agencyId)).find((u) => u.role === "admin");
    if (!admin) throw new Error("seed: no admin user to send the clarification");
    await transitionRequest(deps, {
      agencyId,
      requestId: jordanRequest.id,
      to: "in_review",
      actorUserId: admin.id,
    });
    await sendStaffMessage(deps, {
      agencyId,
      requestId: jordanRequest.id,
      actorUserId: admin.id,
      subject: `Your records request ${jordanRequest.publicId} — a quick question`,
      body: [
        "Hi Jordan,",
        "",
        "Thanks for your request. 400 Main St has inspection records from three programs — building, fire, and health. Do you want all three, or a specific one?",
        "",
        "A quick reply here keeps your request moving.",
        "",
        "Dana Okafor, City Clerk's Office",
      ].join("\n"),
      requestClarification: true,
    });
  }

  // A third request sits at the redaction step: the incident report is in the
  // review set with real extractable bytes full of PII — open the studio,
  // accept the pre-scan suggestions, and burn a true-redacted release copy.
  {
    const repo = deps.repo;
    const admin = (await repo.listUsers(agencyId)).find((u) => u.role === "admin");
    if (!admin) throw new Error("seed: no admin user for the redaction demo");
    const police = (await repo.listDepartments(agencyId)).find((d) => d.name === "Police Records");
    const incidentRequest = await submitRequest(deps, {
      agencyId,
      rawText: "The police incident report for the June 2025 vehicle damage at 400 Main St.",
      requester: { email: "morgan@example.com", name: "Morgan Reyes", type: "individual" },
    });
    await transitionRequest(deps, { agencyId, requestId: incidentRequest.id, to: "in_review", actorUserId: admin.id });
    await transitionRequest(deps, { agencyId, requestId: incidentRequest.id, to: "in_progress", actorUserId: admin.id });
    const task = await dispatchTask(deps, {
      agencyId,
      requestId: incidentRequest.id,
      departmentId: police?.id,
      departmentName: police?.name ?? "Police Records",
      departmentEmail: police?.defaultResponderEmails[0] ?? "records@riverton.gov",
      scopeText: "Pull the June 2025 incident report for 400 Main St.",
      dueAt: new Date(Date.now() + 3 * 86_400_000),
      actorUserId: admin.id,
    });
    await startTask(deps, agencyId, task.id);
    const report = Buffer.from(REDACTION_DEMO.lines.join("\n"), "utf8");
    const key = await getBlobStore().put(
      blobKey(agencyId, REDACTION_DEMO.documentName),
      report,
      "text/plain",
    );
    const extracted = extractText(report, "text/plain");
    await submitTaskRecords(deps, {
      agencyId,
      taskId: task.id,
      uploads: [
        {
          name: REDACTION_DEMO.documentName,
          pages: 1,
          blobRef: key,
          byteSize: report.length,
          mimeType: "text/plain",
          checksum: checksumOf(report),
          extractedText: extracted?.lines.join("\n"),
          pageCount: extracted?.pageCount,
        },
      ],
    });
    await acceptTaskRecords(deps, { agencyId, taskId: task.id, actorUserId: admin.id });

    // The incident report carries a retention schedule inside the 30-day
    // warning window, so the retention-destruction warning (command center
    // card + nightly sweep) has a live demo moment: an open request whose
    // responsive record is about to be destroyed on schedule.
    const reviewDocs = await repo.listRequestDocuments(agencyId, incidentRequest.id);
    const incidentDoc = reviewDocs.find((d) => d.filename === REDACTION_DEMO.documentName);
    if (incidentDoc) {
      await repo.updateDocument(agencyId, incidentDoc.id, {
        retentionUntil: new Date(Date.now() + 21 * 86_400_000),
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

  // Records-ingestion demo: piped-in connector docs sitting UNDECIDED in the
  // publication queue (/riverton/app/records) — one with real PDF bytes, two
  // metadata-only. Runs through the real import service, so the file-drop
  // source, the audit event, and the internal-only invariant are all live.
  {
    const { parseRecordsCsv } = await import("@/domain/recordsImport");
    const { importRecords } = await import("@/services/recordsImportService");
    const { getVirusScanner } = await import("@/adapters/virusScan");
    const csv = [
      "external_id,title,summary,date,record_type,tags,keywords,filename",
      'FD-2026-0007,"Vendor payment register — Q2 2026","Quarterly vendor payment register exported from the finance system.",2026-07-01,report,"finance","vendor payments invoices",vendor-payments-q2-2026.pdf',
      ',"Building permits issued — June 2026","Monthly permit log from the permitting system.",2026-07-02,log,"permits","building permits june",',
      ',"Fleet fuel-card statements, H1 2026","Raw statement export; may include cardholder details.",2026-07-10,statement,"finance; fleet","fuel card statements",',
    ].join("\n");
    await importRecords(
      { ...deps, blobStore: getBlobStore(), virusScanner: getVirusScanner() },
      {
        agencyId,
        actorUserId: COORDINATOR_ID,
        rows: parseRecordsCsv(csv).rows,
        files: new Map([
          [
            "vendor-payments-q2-2026.pdf",
            { bytes: demoPdf("Vendor Payment Register Q2 2026"), mimeType: "application/pdf" },
          ],
        ]),
      },
    );
  }

  // Connected data source (docs/connected-sources.md phase 1): Riverton's
  // street-sweeping log syncs in as monthly dataset slices through the REAL
  // register + sync path (memory connector — the seed writes no directories).
  // Two months are published by a named human so the answer box demos
  // "street cleanings for the last 3 months" with the automated-data flag;
  // the newest slice stays UNDECIDED so the records queue shows a sync
  // awaiting review.
  {
    const { registerConnectedSource, syncConnectedSource } = await import(
      "@/services/connectedSourceService"
    );
    const { publishDocument } = await import("@/services/publicationService");
    const { createMemoryConnector } = await import("@/adapters/dataSource");
    const { getVirusScanner } = await import("@/adapters/virusScan");
    const { source } = await registerConnectedSource(deps, {
      agencyId,
      actorUserId: COORDINATOR_ID,
      name: "Riverton open data portal",
    });
    const sweepCsv = (month: string, rows: string[]) =>
      ["date,route,neighborhood", ...rows].join("\n").replace(/MONTH/g, month);
    await syncConnectedSource(
      { ...deps, blobStore: getBlobStore(), virusScanner: getVirusScanner() },
      { agencyId, sourceId: source.id, actorLabel: "Scheduled sync" },
      createMemoryConnector([
        {
          dataset: "street-sweeping",
          period: "2026-06",
          csv: sweepCsv("2026-06", ["MONTH-03,Route 4 North,Riverbend", "MONTH-17,Route 4 South,Riverbend", "MONTH-24,Route 9,Old Town"]),
        },
        {
          dataset: "street-sweeping",
          period: "2026-07",
          csv: sweepCsv("2026-07", ["MONTH-01,Route 4 North,Riverbend", "MONTH-15,Route 4 South,Riverbend", "MONTH-29,Route 9,Old Town"]),
        },
        {
          dataset: "street-sweeping",
          period: "2026-08",
          csv: sweepCsv("2026-08", ["MONTH-05,Route 4 North,Riverbend", "MONTH-12,Route 9,Old Town"]),
        },
      ]),
    );
    // A named human publishes June + July; August waits in the queue.
    const repo = deps.repo;
    const slices = (await repo.listDocuments(agencyId)).filter((d) => d.sourceId === source.id);
    for (const period of ["2026-06", "2026-07"]) {
      const doc = slices.find((d) => d.externalSystemId === `street-sweeping:${period}`);
      if (doc) await publishDocument(deps, { agencyId, actorUserId: COORDINATOR_ID, documentId: doc.id });
    }
  }

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

  // Phase-3 demo moment: Bellmar in Riverton's referral directory, PEER-LINKED
  // — so Refer becomes "Refer & forward" and a request re-files across tenants
  // with one click (the platform operator manages these links in /admin).
  await deps.repo.createDirectoryEntry({
    id: deps.genId(),
    agencyId,
    peerAgencyId: bellmar.id,
    name: "City of Bellmar",
    jurisdictionType: "city",
    contactEmail: "records@bellmar.gov",
    contactPhone: null,
    portalUrl: null,
    recordTypes: ["Bellmar city records", "sheriff records", "parks records"],
    notes: `Neighboring city on this ${branding.productName} deployment — referrals forward directly.`,
  });

  console.log("Seeded City of Riverton (/riverton) and City of Bellmar (/bellmar).");
  console.log(`Bellmar ingestion API key (shown once): ${bellmarIngestKey}`);
  return { seeded: true };
}

export function printCredentials() {
  console.log(`
Demo credentials
  Riverton staff admin   /riverton/app/login   dana@riverton.gov / riverton-demo
  Riverton coordinator   /riverton/app/login   casey@riverton.gov / riverton-demo2
  Riverton responder     /riverton/app/login   sam@riverton.gov / riverton-demo3 (Public Works only)
  Riverton resident      /riverton/login       jordan@rivertonledger.com / riverton-resident
  Bellmar staff admin    /bellmar/app/login    amara@bellmar.gov / bellmar-demo
  Platform operator      /admin/login          admin@brandeis.example / brandeis-admin-dev
                         (override with PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD)`);
}

