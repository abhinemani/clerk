/**
 * "Full city" demo data — a much larger, historically-spread layer on top of
 * `seedDemoTenants` (src/lib/seedDemo.ts) for exercising the product like a
 * real records office: more departments, more staff, a real requester roster,
 * and ~45 additional Riverton requests covering EVERY request status, spread
 * across the last ~6 months so SLA risk, the archive, deflection ROI, and the
 * learning loop ("plays", docs/learning-loop.md) all have real bodies of data
 * instead of a handful of same-day demo requests.
 *
 * Idempotent (checked on a marker department) and additive: it never touches
 * what seedDemoTenants already created, and assumes the base seed has already
 * run (call seedDemoTenants() first — scripts/seedFullCity.ts does).
 *
 * Dates are computed relative to the REAL wall clock at run time (not a fixed
 * calendar date), so "overdue" / "due soon" always read correctly whenever
 * this is actually run: each scenario builds its own ServiceDeps with `now`
 * pinned to a historical offset, so every event's createdAt/receivedAt/
 * statutoryDueAt lands where a real request filed that many days ago would.
 */
import { blobKey, checksumOf, getBlobStore } from "@/adapters/blobStore";
import { hashPassword } from "@/auth/passwords";
import { AGENCY_ID as RIVERTON_ID } from "@/lib/bootstrap";
import { demoPdf } from "@/lib/seedDemo";
import { getRepository } from "@/db/createRepository";
import { registerRequester } from "@/services/accountService";
import { defaultDeps, type ServiceDeps } from "@/services/deps";
import { logDeflection } from "@/services/deflectionService";
import { rebuildAgencyPlays } from "@/services/learningService";
import { sendStaffMessage, postRequesterReply } from "@/services/messageService";
import { forwardRequest, referRequest } from "@/services/referralService";
import { denyRequest, fulfillByReference, releaseRequest, reviewDocument } from "@/services/releaseService";
import { extendRequest, submitRequest, transitionRequest } from "@/services/requestService";
import type { RequesterType } from "@/services/repository";
import { acceptTaskRecords, dispatchTask, startTask, submitTaskRecords } from "@/services/taskService";

const REAL_NOW = new Date();
const DAY = 86_400_000;
function daysAgo(n: number): Date {
  return new Date(REAL_NOW.getTime() - n * DAY);
}

/** A small mutable clock closure — advance() moves it forward within a scenario. */
function makeClock(startAt: Date) {
  let t = startAt.getTime();
  return {
    now: () => new Date(t),
    advance(days: number, hours = 0): Date {
      t += days * DAY + hours * 3_600_000;
      return new Date(t);
    },
  };
}

interface RequesterInput {
  name: string;
  email?: string;
  type: RequesterType;
}

async function upload(agencyId: string, filename: string, title: string, mimeType = "application/pdf") {
  const bytes = demoPdf(title);
  const key = await getBlobStore().put(blobKey(agencyId, filename), bytes, mimeType);
  return {
    name: filename,
    pages: 1,
    blobRef: key,
    byteSize: bytes.length,
    mimeType,
    checksum: checksumOf(bytes),
  };
}

export async function seedFullCity(): Promise<{ seeded: boolean }> {
  const repo = await getRepository();
  const agencyId = RIVERTON_ID;
  const base = defaultDeps(repo);

  const marker = (await repo.listDepartments(agencyId)).find((d) => d.name === "Fire Department");
  if (marker) return { seeded: false };

  const admin = (await repo.listUsers(agencyId)).find((u) => u.role === "admin");
  if (!admin) throw new Error("seedFullCity: base seed hasn't run — no admin user for Riverton");
  const adminId = admin.id;

  // ---- More departments — a full-service city, not one clerk's office -----
  const newDepts = [
    { name: "Parks & Recreation", email: "dblake@riverton.gov" },
    { name: "Fire Department", email: "mtorres@riverton.gov" },
    { name: "Finance", email: "apark@riverton.gov" },
    { name: "Planning & Building", email: "lnguyen@riverton.gov" },
    { name: "Human Resources", email: "kwashington@riverton.gov" },
    { name: "IT Services", email: "rortiz@riverton.gov" },
  ];
  for (const d of newDepts) {
    await repo.createDepartment({
      id: base.genId(),
      agencyId,
      name: d.name,
      defaultResponderEmails: [d.email],
    });
  }
  const deptByName = new Map((await repo.listDepartments(agencyId)).map((d) => [d.name, d.id]));

  // ---- More staff logins — department-scoped responders beyond Sam Iyer ---
  const responderRoster: { name: string; email: string; dept: string }[] = [
    { name: "Noor Delgado", email: "noor@riverton.gov", dept: "Police Records" },
    { name: "Miguel Torres", email: "miguel@riverton.gov", dept: "Fire Department" },
    { name: "Alicia Park", email: "alicia@riverton.gov", dept: "Finance" },
  ];
  for (const [i, r] of responderRoster.entries()) {
    const user = await repo.createUser({
      id: base.genId(),
      agencyId,
      email: r.email,
      name: r.name,
      role: "responder",
      passwordHash: hashPassword(`riverton-demo${10 + i}`),
    });
    const deptId = deptByName.get(r.dept);
    if (deptId) await repo.setUserDepartments(agencyId, user.id, [deptId]);
  }

  // ---- Referral directory — targets distinct from the base seed's trio ----
  const bellmar = await repo.getAgencyBySlug("bellmar");
  const housingAuthorityId = base.genId();
  await repo.createDirectoryEntry({
    id: housingAuthorityId,
    agencyId,
    peerAgencyId: null,
    name: "Riverton Housing Authority",
    jurisdictionType: "special_district",
    contactEmail: "records@rivertonhousing.example",
    contactPhone: "(555) 010-4400",
    portalUrl: null,
    recordTypes: ["Section 8 waitlists", "public housing inspection reports"],
    notes: "Independent authority — housing records are theirs, not the city's.",
  });
  const coastalCommissionId = base.genId();
  await repo.createDirectoryEntry({
    id: coastalCommissionId,
    agencyId,
    peerAgencyId: null,
    name: "State Coastal Commission",
    jurisdictionType: "state",
    contactEmail: "publicrecords@coastal.ca.example",
    contactPhone: null,
    portalUrl: "https://coastal.ca.example/records",
    recordTypes: ["shoreline development permits", "coastal use permits"],
    notes: null,
  });
  let bellmarDirectoryId: string | null = null;
  if (bellmar) {
    bellmarDirectoryId = base.genId();
    await repo.createDirectoryEntry({
      id: bellmarDirectoryId,
      agencyId,
      peerAgencyId: bellmar.id,
      name: "City of Bellmar — Sheriff's Office",
      jurisdictionType: "city",
      contactEmail: "records@bellmar.gov",
      contactPhone: null,
      portalUrl: null,
      recordTypes: ["Bellmar sheriff use-of-force statistics"],
      notes: "Neighboring city on this deployment — forwards directly.",
    });
  }

  // ---- Requester roster — reused across multiple filings where realistic --
  const R = {
    priya: { name: "Priya Anand", email: "priya.anand@example.com", type: "individual" as const },
    tomás: { name: "Tomás Reyes", email: "tomas.reyes@example.com", type: "individual" as const },
    genPublic1: { name: "Sarah Kim", email: "sarah.kim@example.com", type: "individual" as const },
    genPublic2: { name: "Leon Brooks", email: "leon.brooks@example.com", type: "individual" as const },
    genPublic3: { name: "Maria Ibarra", email: "maria.ibarra@example.com", type: "individual" as const },
    genPublic4: { name: "David Okonkwo", email: "d.okonkwo@example.com", type: "individual" as const },
    genPublic5: { name: "Grace Lindqvist", email: "grace.l@example.com", type: "individual" as const },
    reporter1: { name: "Nia Osei", email: "nia@rivertonledger.com", type: "media" as const },
    reporter2: { name: "Ben Farrell", email: "bfarrell@statewirenews.example", type: "media" as const },
    lawfirm1: { name: "Carla Whitfield, Esq.", email: "cwhitfield@whitfieldlaw.example", type: "legal" as const },
    lawfirm2: { name: "Owen Marsh, Esq.", email: "omarsh@marshpartners.example", type: "legal" as const },
    dataBroker: { name: "Insight Municipal Data", email: "requests@insightmunicipal.example", type: "commercial" as const },
    consultant: { name: "Westlake Records Solutions", email: "intake@westlakerecords.example", type: "commercial" as const },
    countyAssessor: { name: "Riverton County Assessor's Office", email: "assessor@rivertoncounty.example", type: "government" as const },
    stateAgency: { name: "CA Dept. of Housing & Community Dev.", email: "records@hcd.ca.example", type: "government" as const },
    neighbor1: { name: "Elena Vasquez", email: "elena.v@example.com", type: "individual" as const },
    neighbor2: { name: "James Whitfield", email: "jwhitfield@example.com", type: "individual" as const },
    activist: { name: "Riverton Transparency Watch", email: "info@rivertontransparency.example", type: "commercial" as const },
  };

  // ============================================================
  // 1) SUBMITTED — fresh, untriaged (the queue staff see first)
  // ============================================================
  const submittedOnly: { req: RequesterInput; text: string; daysAgo: number }[] = [
    { req: R.reporter2, text: "Body camera footage from the July 4th parade route.", daysAgo: 3 },
    { req: R.genPublic1, text: "Current fire inspection reports for downtown restaurants.", daysAgo: 2 },
    { req: R.neighbor1, text: "All 311 pothole complaints filed in the last 60 days.", daysAgo: 1 },
    { req: R.dataBroker, text: "HR salary schedule for all city positions.", daysAgo: 1 },
    { req: R.genPublic2, text: "Planning commission staff reports for the August meeting.", daysAgo: 0 },
  ];
  for (const s of submittedOnly) {
    const clock = makeClock(daysAgo(s.daysAgo));
    const deps: ServiceDeps = { ...base, now: clock.now };
    await submitRequest(deps, { agencyId, rawText: s.text, requester: s.req });
  }

  // ============================================================
  // 2) IN_REVIEW — triage accepted, awaiting dispatch
  // ============================================================
  const inReview: { req: RequesterInput; text: string; daysAgo: number }[] = [
    { req: R.lawfirm1, text: "Copies of the FY2026 general fund budget amendments.", daysAgo: 6 },
    { req: R.genPublic3, text: "Vendor contract for the new city website redesign.", daysAgo: 5 },
    { req: R.neighbor2, text: "Records of code enforcement complaints at 88 Willow Ave.", daysAgo: 4 },
    { req: R.reporter1, text: "Council member travel expense reports for 2025.", daysAgo: 3 },
  ];
  for (const s of inReview) {
    const clock = makeClock(daysAgo(s.daysAgo));
    const deps: ServiceDeps = { ...base, now: clock.now };
    const request = await submitRequest(deps, { agencyId, rawText: s.text, requester: s.req });
    clock.advance(0, 6);
    await transitionRequest(deps, { agencyId, requestId: request.id, to: "in_review", actorUserId: adminId });
  }

  // ============================================================
  // 3) CLARIFICATION_NEEDED — two parked, one resumes and moves on
  // ============================================================
  {
    const parked: { req: RequesterInput; text: string; question: string; daysAgo: number }[] = [
      {
        req: R.genPublic4,
        text: "All emails between the mayor's office and the developer of the Elm St project.",
        question:
          "Hi — do you want emails from any city staff mailbox that mention the project, or specifically the mayor's office account? The scope changes this from a few dozen messages to potentially thousands.",
        daysAgo: 12,
      },
      {
        req: R.consultant,
        text: "Every building permit issued in Riverton since 2020.",
        question:
          "That's roughly 6 years of permits across every property in the city. Can you narrow to a date range, neighborhood, or permit type so we can scope the pull?",
        daysAgo: 9,
      },
    ];
    for (const s of parked) {
      const clock = makeClock(daysAgo(s.daysAgo));
      const deps: ServiceDeps = { ...base, now: clock.now };
      const request = await submitRequest(deps, { agencyId, rawText: s.text, requester: s.req });
      clock.advance(0, 8);
      await transitionRequest(deps, { agencyId, requestId: request.id, to: "in_review", actorUserId: adminId });
      clock.advance(0, 4);
      await sendStaffMessage(deps, {
        agencyId,
        requestId: request.id,
        actorUserId: adminId,
        subject: `Your records request ${request.publicId} — a quick question`,
        body: [`Hi ${s.req.name.split(" ")[0]},`, "", s.question, "", "— Dana Okafor, City Clerk's Office"].join("\n"),
        requestClarification: true,
      });
    }

    // The resumed one: requester replies, work continues into in_progress.
    const clock = makeClock(daysAgo(20));
    const deps: ServiceDeps = { ...base, now: clock.now };
    const resumed = await submitRequest(deps, {
      agencyId,
      rawText: "Inspection records for the old Riverton Cannery site.",
      requester: R.stateAgency,
    });
    clock.advance(0, 6);
    await transitionRequest(deps, { agencyId, requestId: resumed.id, to: "in_review", actorUserId: adminId });
    clock.advance(0, 4);
    await sendStaffMessage(deps, {
      agencyId,
      requestId: resumed.id,
      actorUserId: adminId,
      subject: `Your records request ${resumed.publicId} — a quick question`,
      body: "Which program's inspections — building, fire, or environmental? The Cannery site has files under all three.",
      requestClarification: true,
    });
    clock.advance(2, 0);
    const requesterRow = await repo.findRequesterByEmail(agencyId, R.stateAgency.email!);
    if (requesterRow) {
      await postRequesterReply(deps, {
        agencyId,
        requestId: resumed.id,
        requesterId: requesterRow.id,
        body: "Environmental inspections only, please — we're doing a brownfield redevelopment review.",
      });
    }
    clock.advance(1, 0);
    await transitionRequest(deps, { agencyId, requestId: resumed.id, to: "in_progress", actorUserId: adminId });
    const deptId = deptByName.get("Planning & Building")!;
    await dispatchTask(deps, {
      agencyId,
      requestId: resumed.id,
      departmentId: deptId,
      departmentName: "Planning & Building",
      departmentEmail: "lnguyen@riverton.gov",
      scopeText: "Environmental inspection records, former Cannery site.",
      dueAt: clock.advance(5, 0),
      actorUserId: adminId,
    });
  }

  // ============================================================
  // 4) IN_PROGRESS — dispatched; some overdue, one extended
  // ============================================================
  const inProgress: {
    req: RequesterInput;
    text: string;
    dept: string;
    email: string;
    scope: string;
    daysAgo: number;
    extend?: boolean;
  }[] = [
    {
      req: R.reporter1,
      text: "Overtime pay records for the Police Department, 2025.",
      dept: "Finance",
      email: "apark@riverton.gov",
      scope: "PD overtime pay records, calendar 2025.",
      daysAgo: 25, // CA clock (10 days) — overdue
    },
    {
      req: R.lawfirm2,
      text: "All incident reports involving a specific intersection, 2024–2025.",
      dept: "Police Records",
      email: "noor@riverton.gov",
      scope: "Incident reports, Main & 5th intersection, 2024-2025.",
      daysAgo: 18, // overdue
    },
    {
      req: R.genPublic5,
      text: "Tree removal permits issued in the Riverbend neighborhood this year.",
      dept: "Parks & Recreation",
      email: "dblake@riverton.gov",
      scope: "Riverbend tree removal permits, current year.",
      daysAgo: 5,
      extend: true,
    },
    {
      req: R.neighbor1,
      text: "City network security incident log for the last 12 months.",
      dept: "IT Services",
      email: "rortiz@riverton.gov",
      scope: "Security incident log, trailing 12 months.",
      daysAgo: 3,
    },
    {
      req: R.activist,
      text: "Fire hydrant inspection and flow-test records, citywide.",
      dept: "Fire Department",
      email: "miguel@riverton.gov",
      scope: "Hydrant inspection + flow-test records, citywide.",
      daysAgo: 2,
    },
    {
      req: R.genPublic3,
      text: "Minutes and attendance for the Parks & Recreation Commission, 2026.",
      dept: "City Clerk",
      email: "pshah@riverton.gov",
      scope: "Parks Commission minutes + attendance, 2026 to date.",
      daysAgo: 1,
    },
  ];
  for (const s of inProgress) {
    const clock = makeClock(daysAgo(s.daysAgo));
    const deps: ServiceDeps = { ...base, now: clock.now };
    const request = await submitRequest(deps, { agencyId, rawText: s.text, requester: s.req });
    clock.advance(0, 6);
    await transitionRequest(deps, { agencyId, requestId: request.id, to: "in_review", actorUserId: adminId });
    clock.advance(0, 4);
    await transitionRequest(deps, { agencyId, requestId: request.id, to: "in_progress", actorUserId: adminId });
    const task = await dispatchTask(deps, {
      agencyId,
      requestId: request.id,
      departmentId: deptByName.get(s.dept),
      departmentName: s.dept,
      departmentEmail: s.email,
      scopeText: s.scope,
      dueAt: request.statutoryDueAt ?? clock.advance(3, 0),
      actorUserId: adminId,
    });
    await startTask(deps, agencyId, task.id);
    if (s.extend) {
      clock.advance(1, 0);
      await extendRequest(deps, {
        agencyId,
        requestId: request.id,
        actorUserId: adminId,
        days: 14,
        reason: "voluminous separate records",
        note: "Cross-referencing permits against the arborist's field logs.",
      });
    }
  }

  // ============================================================
  // 5) RECORDS_REVIEW — task done, documents undecided in the queue
  // ============================================================
  const recordsReview: { req: RequesterInput; text: string; dept: string; email: string; scope: string; file: string; title: string; daysAgo: number }[] = [
    {
      req: R.genPublic4,
      text: "Public Works maintenance logs for Route 9, this year.",
      dept: "Public Works",
      email: "mbell@riverton.gov",
      scope: "Route 9 maintenance logs, current year.",
      file: "route9-maintenance-log.pdf",
      title: "Route 9 Maintenance Log",
      daysAgo: 10,
    },
    {
      req: R.reporter2,
      text: "Non-criminal police case file index for Q1 2026.",
      dept: "Police Records",
      email: "noor@riverton.gov",
      scope: "Non-criminal case index, Q1 2026.",
      file: "police-case-index-q1-2026.pdf",
      title: "Non-Criminal Case Index — Q1 2026",
      daysAgo: 7,
    },
    {
      req: R.lawfirm1,
      text: "Index of executive session minutes for City Council, 2025.",
      dept: "City Clerk",
      email: "pshah@riverton.gov",
      scope: "Executive session index, 2025.",
      file: "executive-session-index-2025.pdf",
      title: "Executive Session Index — 2025",
      daysAgo: 4,
    },
    {
      req: R.dataBroker,
      text: "Check register for March 2026.",
      dept: "Finance",
      email: "apark@riverton.gov",
      scope: "Check register, March 2026.",
      file: "check-register-march-2026.pdf",
      title: "Check Register — March 2026",
      daysAgo: 2,
    },
  ];
  for (const s of recordsReview) {
    const clock = makeClock(daysAgo(s.daysAgo));
    const deps: ServiceDeps = { ...base, now: clock.now };
    const request = await submitRequest(deps, { agencyId, rawText: s.text, requester: s.req });
    clock.advance(0, 6);
    await transitionRequest(deps, { agencyId, requestId: request.id, to: "in_review", actorUserId: adminId });
    clock.advance(0, 4);
    await transitionRequest(deps, { agencyId, requestId: request.id, to: "in_progress", actorUserId: adminId });
    const task = await dispatchTask(deps, {
      agencyId,
      requestId: request.id,
      departmentId: deptByName.get(s.dept),
      departmentName: s.dept,
      departmentEmail: s.email,
      scopeText: s.scope,
      dueAt: request.statutoryDueAt ?? clock.advance(3, 0),
      actorUserId: adminId,
    });
    await startTask(deps, agencyId, task.id);
    clock.advance(2, 0);
    const file = await upload(agencyId, s.file, s.title);
    await submitTaskRecords(deps, { agencyId, taskId: task.id, uploads: [file] });
    clock.advance(0, 12);
    await acceptTaskRecords(deps, { agencyId, taskId: task.id, actorUserId: adminId });
  }

  // ============================================================
  // 6) PARTIALLY_FULFILLED — full production, mixed release decisions
  // ============================================================
  const partial: {
    req: RequesterInput;
    text: string;
    dept: string;
    email: string;
    scope: string;
    docs: { file: string; title: string; decision: "release" | "withhold"; exemption?: string }[];
    daysAgo: number;
  }[] = [
    {
      req: R.reporter1,
      text: "Police incident reports near Main & 5th, calendar 2025.",
      dept: "Police Records",
      email: "noor@riverton.gov",
      scope: "Incident reports, Main & 5th, 2025.",
      docs: [
        { file: "incident-report-2025-0142.pdf", title: "Incident Report 2025-0142", decision: "release" },
        {
          file: "incident-report-2025-0201.pdf",
          title: "Incident Report 2025-0201",
          decision: "withhold",
          exemption: "Active investigation — Cal. Gov. Code § 7923.600",
        },
      ],
      daysAgo: 35,
    },
    {
      req: R.consultant,
      text: "IT security incident reports for city systems, last 2 years.",
      dept: "IT Services",
      email: "rortiz@riverton.gov",
      scope: "Security incident reports, trailing 2 years.",
      docs: [
        { file: "it-incident-2024-11.pdf", title: "IT Security Incident — Nov 2024", decision: "release" },
        {
          file: "it-incident-2025-06.pdf",
          title: "IT Security Incident — June 2025",
          decision: "withhold",
          exemption: "Ongoing law enforcement referral — Cal. Gov. Code § 7923.600",
        },
      ],
      daysAgo: 20,
    },
    {
      req: R.lawfirm2,
      text: "HR investigation summary for a workplace complaint (non-identifying).",
      dept: "Human Resources",
      email: "kwashington@riverton.gov",
      scope: "De-identified HR complaint investigation summary.",
      docs: [
        { file: "hr-complaint-summary.pdf", title: "HR Complaint Investigation Summary", decision: "release" },
        {
          file: "hr-complaint-personnel-file.pdf",
          title: "Personnel File Excerpt",
          decision: "withhold",
          exemption: "Personal privacy — Cal. Gov. Code § 7927.700",
        },
      ],
      daysAgo: 6,
    },
  ];
  for (const s of partial) {
    const clock = makeClock(daysAgo(s.daysAgo));
    const deps: ServiceDeps = { ...base, now: clock.now };
    const request = await submitRequest(deps, { agencyId, rawText: s.text, requester: s.req });
    clock.advance(0, 6);
    await transitionRequest(deps, { agencyId, requestId: request.id, to: "in_review", actorUserId: adminId });
    clock.advance(0, 4);
    await transitionRequest(deps, { agencyId, requestId: request.id, to: "in_progress", actorUserId: adminId });
    const task = await dispatchTask(deps, {
      agencyId,
      requestId: request.id,
      departmentId: deptByName.get(s.dept),
      departmentName: s.dept,
      departmentEmail: s.email,
      scopeText: s.scope,
      dueAt: request.statutoryDueAt ?? clock.advance(3, 0),
      actorUserId: adminId,
    });
    await startTask(deps, agencyId, task.id);
    clock.advance(2, 0);
    const uploads = [];
    for (const d of s.docs) uploads.push(await upload(agencyId, d.file, d.title));
    await submitTaskRecords(deps, { agencyId, taskId: task.id, uploads });
    clock.advance(0, 12);
    await acceptTaskRecords(deps, { agencyId, taskId: task.id, actorUserId: adminId });
    const reviewDocs = await repo.listRequestDocuments(agencyId, request.id);
    for (const d of s.docs) {
      const doc = reviewDocs.find((rd) => rd.filename === d.file);
      if (!doc) continue;
      clock.advance(0, 1);
      await reviewDocument(deps, {
        agencyId,
        requestId: request.id,
        documentId: doc.id,
        decision: d.decision,
        exemptionLabel: d.exemption,
        actorUserId: adminId,
      });
    }
    clock.advance(0, 3);
    await releaseRequest(deps, {
      agencyId,
      requestId: request.id,
      actorUserId: adminId,
      visibility: "private",
    });
  }

  // ============================================================
  // 7) FULFILLED — full production (clustered for the learning loop)
  //    + fulfillByReference against the base seed's public archive
  // ============================================================
  const potholeCluster: { req: RequesterInput; text: string; daysAgo: number }[] = [
    { req: R.priya, text: "Pothole repair records for Maple Ave, last 6 months.", daysAgo: 160 },
    { req: R.tomás, text: "Pothole repair records for Cedar St, last 6 months.", daysAgo: 110 },
    { req: R.genPublic1, text: "Pothole repair records for Birch Lane, this year.", daysAgo: 55 },
  ];
  const minutesCluster: { req: RequesterInput; text: string; daysAgo: number }[] = [
    { req: R.reporter1, text: "City Council minutes for the last 3 meetings.", daysAgo: 130 },
    { req: R.genPublic2, text: "City Council minutes covering the budget vote.", daysAgo: 45 },
  ];
  const permitCluster: { req: RequesterInput; text: string; daysAgo: number }[] = [
    { req: R.consultant, text: "Building permit history for 212 Oak Avenue.", daysAgo: 95 },
    { req: R.lawfirm1, text: "Building permit history for 47 Sycamore Ct.", daysAgo: 30 },
  ];
  for (const [cluster, dept, email] of [
    [potholeCluster, "Public Works", "mbell@riverton.gov"],
    [minutesCluster, "City Clerk", "pshah@riverton.gov"],
    [permitCluster, "Planning & Building", "lnguyen@riverton.gov"],
  ] as const) {
    for (const s of cluster) {
      const clock = makeClock(daysAgo(s.daysAgo));
      const deps: ServiceDeps = { ...base, now: clock.now };
      const request = await submitRequest(deps, { agencyId, rawText: s.text, requester: s.req });
      clock.advance(0, 6);
      await transitionRequest(deps, { agencyId, requestId: request.id, to: "in_review", actorUserId: adminId });
      clock.advance(0, 4);
      await transitionRequest(deps, { agencyId, requestId: request.id, to: "in_progress", actorUserId: adminId });
      const task = await dispatchTask(deps, {
        agencyId,
        requestId: request.id,
        departmentId: deptByName.get(dept),
        departmentName: dept,
        departmentEmail: email,
        scopeText: s.text,
        dueAt: request.statutoryDueAt ?? clock.advance(3, 0),
        actorUserId: adminId,
      });
      await startTask(deps, agencyId, task.id);
      clock.advance(2, 0);
      const file = await upload(agencyId, `${task.id}-record.pdf`, s.text.slice(0, 60));
      await submitTaskRecords(deps, { agencyId, taskId: task.id, uploads: [file] });
      clock.advance(0, 10);
      await acceptTaskRecords(deps, { agencyId, taskId: task.id, actorUserId: adminId });
      const reviewDocs = await repo.listRequestDocuments(agencyId, request.id);
      for (const doc of reviewDocs) {
        clock.advance(0, 1);
        await reviewDocument(deps, { agencyId, requestId: request.id, documentId: doc.id, decision: "release", actorUserId: adminId });
      }
      clock.advance(0, 3);
      await releaseRequest(deps, { agencyId, requestId: request.id, actorUserId: adminId, visibility: "private" });
    }
  }

  // Answered by citation — the archive already has these three public docs.
  const byReference: { req: RequesterInput; text: string; externalId: string; daysAgo: number }[] = [
    { req: R.genPublic3, text: "Is the Acme paving contract for street resurfacing public?", externalId: "riverton-acme-paving-2025", daysAgo: 70 },
    { req: R.genPublic4, text: "Council minutes from 2024 — are they posted anywhere?", externalId: "riverton-council-minutes-2024", daysAgo: 40 },
    { req: R.reporter2, text: "The adopted FY2025 budget document, if it's already public.", externalId: "riverton-budget-fy2025", daysAgo: 15 },
  ];
  for (const s of byReference) {
    const clock = makeClock(daysAgo(s.daysAgo));
    const deps: ServiceDeps = { ...base, now: clock.now };
    const request = await submitRequest(deps, { agencyId, rawText: s.text, requester: s.req });
    clock.advance(0, 4);
    await transitionRequest(deps, { agencyId, requestId: request.id, to: "in_review", actorUserId: adminId });
    const target = await repo.findLatestDocumentByExternalId(agencyId, s.externalId);
    if (target) {
      clock.advance(0, 2);
      await fulfillByReference(deps, { agencyId, requestId: request.id, documentId: target.id, actorUserId: adminId });
    }
  }

  // ============================================================
  // 8) DENIED — varied exemptions, one no-records
  // ============================================================
  const denials: { req: RequesterInput; text: string; exemptions: { citation: string; label: string }[]; noRecords?: boolean; explanation?: string; daysAgo: number }[] = [
    {
      req: R.reporter1,
      text: "Personnel disciplinary files for a named police officer.",
      exemptions: [
        { citation: "Cal. Gov. Code § 7927.700", label: "Personal privacy" },
        { citation: "Cal. Gov. Code § 7923.600", label: "Law enforcement investigation" },
      ],
      explanation: "Disciplinary records for sworn personnel are exempt from disclosure under current investigation.",
      daysAgo: 60,
    },
    {
      req: R.lawfirm2,
      text: "Draft internal legal memo on the annexation litigation strategy.",
      exemptions: [{ citation: "Cal. Gov. Code § 7927.200", label: "Attorney-client privilege" }],
      explanation: "The requested memo is privileged attorney work product.",
      daysAgo: 40,
    },
    {
      req: R.genPublic5,
      text: "UFO sighting reports filed with the Riverton Police Department.",
      exemptions: [],
      noRecords: true,
      daysAgo: 15,
    },
  ];
  for (const s of denials) {
    const clock = makeClock(daysAgo(s.daysAgo));
    const deps: ServiceDeps = { ...base, now: clock.now };
    const request = await submitRequest(deps, { agencyId, rawText: s.text, requester: s.req });
    clock.advance(0, 6);
    await transitionRequest(deps, { agencyId, requestId: request.id, to: "in_review", actorUserId: adminId });
    clock.advance(1, 0);
    await denyRequest(deps, {
      agencyId,
      requestId: request.id,
      actorUserId: adminId,
      exemptions: s.exemptions,
      noRecords: s.noRecords,
      explanation: s.explanation,
    });
  }

  // ============================================================
  // 9) REFERRED — including one peer-linked FORWARD to Bellmar
  // ============================================================
  {
    const clock1 = makeClock(daysAgo(50));
    const deps1: ServiceDeps = { ...base, now: clock1.now };
    const req1 = await submitRequest(deps1, {
      agencyId,
      rawText: "Section 8 housing waitlist status records.",
      requester: R.neighbor1,
    });
    clock1.advance(0, 6);
    await transitionRequest(deps1, { agencyId, requestId: req1.id, to: "in_review", actorUserId: adminId });
    clock1.advance(1, 0);
    await referRequest(deps1, {
      agencyId,
      requestId: req1.id,
      directoryEntryId: housingAuthorityId,
      actorUserId: adminId,
      note: "Housing choice voucher records are maintained by the independent Housing Authority, not the city.",
    });

    const clock2 = makeClock(daysAgo(30));
    const deps2: ServiceDeps = { ...base, now: clock2.now };
    const req2 = await submitRequest(deps2, {
      agencyId,
      rawText: "Coastal development permit for the marina expansion.",
      requester: R.stateAgency,
    });
    clock2.advance(0, 6);
    await transitionRequest(deps2, { agencyId, requestId: req2.id, to: "in_review", actorUserId: adminId });
    clock2.advance(1, 0);
    await referRequest(deps2, {
      agencyId,
      requestId: req2.id,
      directoryEntryId: coastalCommissionId,
      actorUserId: adminId,
    });

    if (bellmarDirectoryId) {
      const clock3 = makeClock(daysAgo(10));
      const deps3: ServiceDeps = { ...base, now: clock3.now };
      const req3 = await submitRequest(deps3, {
        agencyId,
        rawText: "Bellmar Sheriff's Office use-of-force statistics for 2025.",
        requester: R.reporter2,
      });
      clock3.advance(0, 6);
      await transitionRequest(deps3, { agencyId, requestId: req3.id, to: "in_review", actorUserId: adminId });
      clock3.advance(1, 0);
      await forwardRequest(deps3, {
        agencyId,
        requestId: req3.id,
        directoryEntryId: bellmarDirectoryId,
        actorUserId: adminId,
      });
    }
  }

  // ============================================================
  // 10) WITHDRAWN
  // ============================================================
  const withdrawals: { req: RequesterInput; text: string; daysAgo: number }[] = [
    { req: R.genPublic1, text: "Cancel my request — I found the records myself on the archive.", daysAgo: 25 },
    { req: R.genPublic2, text: "Please disregard, this was filed by mistake (duplicate).", daysAgo: 8 },
  ];
  for (const s of withdrawals) {
    const clock = makeClock(daysAgo(s.daysAgo));
    const deps: ServiceDeps = { ...base, now: clock.now };
    const request = await submitRequest(deps, { agencyId, rawText: s.text, requester: s.req });
    clock.advance(1, 0);
    await transitionRequest(deps, { agencyId, requestId: request.id, to: "withdrawn", actorUserId: adminId });
    // transitionRequest doesn't stamp closedAt (only terminal-outcome flows
    // do that); a withdrawal is a terminal outcome too, so patch it directly
    // the same way the base seed patches retentionUntil.
    await repo.updateRequest(agencyId, request.id, { closedAt: clock.now() });
  }

  // ============================================================
  // Anonymous filings — no account, tracked by number only
  // ============================================================
  {
    const clock = makeClock(daysAgo(4));
    const deps: ServiceDeps = { ...base, now: clock.now };
    await submitRequest(deps, { agencyId, rawText: "Speed limit study for School St near the elementary school." });
    const clock2 = makeClock(daysAgo(1));
    const deps2: ServiceDeps = { ...base, now: clock2.now };
    await submitRequest(deps2, { agencyId, rawText: "Noise complaint records for the industrial park, 2026." });
  }

  // ---- A couple of registered portal accounts (beyond Jordan) ------------
  for (const [r, pw] of [
    [R.priya, "riverton-priya1"],
    [R.reporter1, "riverton-nia1"],
  ] as const) {
    if (!r.email) continue;
    try {
      const account = await registerRequester(base, {
        agencyId,
        email: r.email,
        name: r.name,
        password: pw,
        type: r.type,
      });
      await repo.updateRequester(agencyId, account.id, { emailVerifiedAt: new Date() });
    } catch {
      // Already registered (idempotent re-run guard is the marker dept, but
      // be defensive) — never let account setup break the whole seed.
    }
  }

  // ============================================================
  // Deflection log — the ROI numbers on the command center / reports
  // ============================================================
  const deflections: { kind: "download" | "scope_down" | "archive_miss"; query: string; daysAgo: number }[] = [
    { kind: "download", query: "council minutes 2024", daysAgo: 150 },
    { kind: "download", query: "acme paving contract", daysAgo: 140 },
    { kind: "download", query: "FY2025 budget", daysAgo: 120 },
    { kind: "download", query: "street resurfacing schedule", daysAgo: 100 },
    { kind: "download", query: "council minutes budget vote", daysAgo: 90 },
    { kind: "download", query: "paving contract acme", daysAgo: 75 },
    { kind: "download", query: "adopted budget capital projects", daysAgo: 60 },
    { kind: "download", query: "city council agenda", daysAgo: 50 },
    { kind: "download", query: "budget allocation departments", daysAgo: 35 },
    { kind: "download", query: "resurfacing contract 2025", daysAgo: 20 },
    { kind: "scope_down", query: "all city emails", daysAgo: 130 },
    { kind: "scope_down", query: "every building permit ever issued", daysAgo: 85 },
    { kind: "scope_down", query: "all police reports citywide", daysAgo: 55 },
    { kind: "scope_down", query: "entire HR personnel database", daysAgo: 22 },
    { kind: "archive_miss", query: "dog park proposal maps", daysAgo: 65 },
    { kind: "archive_miss", query: "city council candidate filings", daysAgo: 42 },
    { kind: "archive_miss", query: "stormwater drainage master plan", daysAgo: 18 },
  ];
  for (const d of deflections) {
    const deps: ServiceDeps = { ...base, now: () => daysAgo(d.daysAgo) };
    await logDeflection(deps, { agencyId, kind: d.kind, query: d.query });
  }

  // ---- Rebuild the learning loop's plays against the closed history above
  await rebuildAgencyPlays(base, agencyId);

  console.log(
    "Seeded the full City of Riverton dataset: 9 departments, 8 staff logins, ~20 requesters, ~45 additional requests across every status.",
  );
  return { seeded: true };
}
