/**
 * Demo fixture — "City of Riverton" (spec §12: the seed demo *is* the sales deck).
 *
 * Static view-model data that drives the prototype UI without a database, chosen
 * to show the whole story: a request that's been triaged and routed, with tasks
 * dispatched to two departments in different states — one submitted for review,
 * one pushed back — so the coordinator ↔ department-responder workflow is visible
 * end to end. Real domain logic (deadline risk, task rollup) runs over this data.
 */
import type { RequestStatus } from "@/domain/requestLifecycle";
import type { TaskStatus } from "@/domain/taskWorkflow";

/** Fixed "now" so the demo's deadlines stay stable. */
export const DEMO_NOW = new Date("2026-07-27T12:00:00Z");

export const DEMO_AGENCY = {
  name: "City of Riverton",
  slug: "riverton",
  state: "CA",
  coordinator: "Dana Okafor",
};

export interface DemoDepartment {
  id: string;
  name: string;
  lead: string;
  email: string;
  description: string;
}

export const DEMO_DEPARTMENTS: DemoDepartment[] = [
  {
    id: "pw",
    name: "Public Works",
    lead: "Marcus Bell",
    email: "mbell@riverton.gov",
    description: "Building inspections, permits, streets, and infrastructure records.",
  },
  {
    id: "pd",
    name: "Police Records",
    lead: "Lt. Rosa Vann",
    email: "rvann@riverton.gov",
    description: "Incident and arrest reports, body-cam footage, dispatch logs.",
  },
  {
    id: "clk",
    name: "City Clerk",
    lead: "Priya Shah",
    email: "pshah@riverton.gov",
    description: "Council agendas and minutes, contracts, ordinances, filings.",
  },
];

export interface DemoUpload {
  name: string;
  pages: number;
}

export interface DemoTask {
  id: string;
  token: string;
  departmentId: string;
  scope: string;
  status: TaskStatus;
  dueAt: Date;
  uploads: DemoUpload[];
  pushbackNote?: string;
}

export interface DemoRequest {
  id: string;
  publicId: string;
  requesterName: string;
  requesterType: string;
  status: RequestStatus;
  rawText: string;
  interpretedScope: string;
  recordTypes: string[];
  redFlags: string[];
  complexityScore: number;
  receivedAt: Date;
  dueAt: Date;
  tasks: DemoTask[];
  /** Whether AI triage has run and awaits coordinator review. */
  triageReady: boolean;
}

const day = (n: number) => new Date(DEMO_NOW.getTime() + n * 86_400_000);

export const DEMO_REQUESTS: DemoRequest[] = [
  {
    id: "00341",
    publicId: "PR-2026-00341",
    requesterName: "Jordan Alvarez",
    requesterType: "media",
    status: "in_progress",
    rawText:
      "I'm requesting all inspection reports and any related police incident reports for the property at 400 Main St from January 2024 to present.",
    interpretedScope:
      "Building inspection reports and related police incident reports for 400 Main St, Jan 2024–present.",
    recordTypes: ["inspection reports", "police reports"],
    redFlags: ["ongoing_investigation"],
    complexityScore: 0.55,
    receivedAt: day(-6),
    dueAt: day(1), // due tomorrow → due_soon band
    triageReady: false,
    tasks: [
      {
        id: "t1",
        token: "pw-400main-7fa1",
        departmentId: "pw",
        scope: "Locate all inspection reports for 400 Main St, Jan 2024–present.",
        status: "submitted",
        dueAt: day(-1),
        uploads: [
          { name: "400-main-inspection-2024-03.pdf", pages: 4 },
          { name: "400-main-inspection-2025-01.pdf", pages: 3 },
          { name: "400-main-reinspection-2025-06.pdf", pages: 2 },
        ],
      },
      {
        id: "t2",
        token: "pd-400main-3b9c",
        departmentId: "pd",
        scope: "Provide any incident reports at 400 Main St, Jan 2024–present.",
        status: "pushed_back",
        dueAt: day(-1),
        uploads: [],
        pushbackNote:
          "One incident at this address is part of an open investigation. Recommend the City Attorney review before release — flagging rather than uploading.",
      },
    ],
  },
  {
    id: "00337",
    publicId: "PR-2026-00337",
    requesterName: "Wei Chen",
    requesterType: "individual",
    status: "records_review",
    rawText: "Copy of the janitorial services contract currently in effect for City Hall.",
    interpretedScope: "The current City Hall janitorial services contract.",
    recordTypes: ["contracts"],
    redFlags: [],
    complexityScore: 0.1,
    receivedAt: day(-9),
    dueAt: day(-2), // overdue
    triageReady: false,
    tasks: [
      {
        id: "t3",
        token: "clk-janitorial-1a2b",
        departmentId: "clk",
        scope: "Pull the active janitorial services contract for City Hall.",
        status: "done",
        dueAt: day(-4),
        uploads: [{ name: "janitorial-contract-2025.pdf", pages: 11 }],
      },
    ],
  },
  {
    id: "00352",
    publicId: "PR-2026-00352",
    requesterName: "Southside Tenants Union",
    requesterType: "legal",
    status: "in_review",
    rawText:
      "Every email mentioning 'rent stabilization' sent or received by the Housing Department in the last 18 months.",
    interpretedScope:
      "All Housing Department emails referencing 'rent stabilization,' Jan 2025–present.",
    recordTypes: ["emails"],
    redFlags: [],
    complexityScore: 0.8,
    receivedAt: day(-1),
    dueAt: day(9),
    triageReady: true, // fresh — AI triage done, needs coordinator review
    tasks: [],
  },
  {
    id: "00354",
    publicId: "PR-2026-00354",
    requesterName: "Anonymous",
    requesterType: "anonymous",
    status: "submitted",
    rawText: "Meeting minutes for every City Council session in 2025.",
    interpretedScope: "All 2025 City Council meeting minutes.",
    recordTypes: ["meeting minutes"],
    redFlags: [],
    complexityScore: 0.2,
    receivedAt: DEMO_NOW,
    dueAt: day(10),
    triageReady: true,
    tasks: [],
  },
];

export interface DemoRelease {
  id: string;
  title: string;
  summary: string;
  date: string;
  tags: string[];
  keywords: string[];
}

/** The public archive that powers browse + the deflection answer box (§6.7). */
export const DEMO_RELEASES: DemoRelease[] = [
  {
    id: "r1",
    title: "Riverton–Acme Paving Contract (2025)",
    summary:
      "Executed street-resurfacing contract with Acme Paving, awarded March 2025, including scope, $1.2M value, and completion schedule.",
    date: "2025-03-18",
    tags: ["contracts", "public works"],
    keywords: ["paving", "acme", "street", "contract", "resurfacing", "road"],
  },
  {
    id: "r2",
    title: "City Council Minutes — 2024",
    summary: "Complete set of adopted City Council meeting minutes for calendar year 2024.",
    date: "2025-01-10",
    tags: ["minutes", "city clerk"],
    keywords: ["council", "minutes", "meeting", "2024", "agenda", "vote"],
  },
  {
    id: "r3",
    title: "Adopted FY2025 City Budget",
    summary: "The adopted fiscal-year 2025 budget with department allocations and capital projects.",
    date: "2024-11-22",
    tags: ["budget", "finance"],
    keywords: ["budget", "finance", "fiscal", "spending", "allocation", "capital"],
  },
];

// --- accessors -------------------------------------------------------------

export function getRequest(id: string): DemoRequest | undefined {
  return DEMO_REQUESTS.find((r) => r.id === id);
}

export function getDepartment(id: string): DemoDepartment | undefined {
  return DEMO_DEPARTMENTS.find((d) => d.id === id);
}

export function findTaskByToken(
  token: string,
): { request: DemoRequest; task: DemoTask } | undefined {
  for (const request of DEMO_REQUESTS) {
    const task = request.tasks.find((t) => t.token === token);
    if (task) return { request, task };
  }
  return undefined;
}

// --- public archive --------------------------------------------------------
// (Oversight rollups — department workload, decisions needed — live in
// src/lib/live.ts now, shared by the live-DB and demo-fixture sources.)

/** Naive public-corpus search for the deflection answer box (§6.7). Public data only. */
export function searchPublicReleases(query: string): DemoRelease[] {
  const q = query.toLowerCase().trim();
  if (q.length < 3) return [];
  const terms = q.split(/\s+/);
  return DEMO_RELEASES.map((r) => {
    const hay = [r.title, r.summary, ...r.tags, ...r.keywords].join(" ").toLowerCase();
    const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
    return { r, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r);
}
