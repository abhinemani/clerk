/**
 * Live view-model assembly (server only) — the seam between the persistence
 * layer and the UI.
 *
 * Pages render one shape (`RequestVM`) from two sources:
 *  - **live**: the configured database via `getRepository()` + the services —
 *    what a filed request flows through;
 *  - **demo**: the City of Riverton fixture (`src/lib/demo.ts`) when the DB has
 *    no agency yet, so a fresh clone still shows the full story (spec §12: the
 *    seed demo *is* the sales deck).
 *
 * Keep this module out of client components — it touches the database.
 */
import { cache } from "react";
import {
  DEMO_AGENCY,
  DEMO_DEPARTMENTS,
  DEMO_NOW,
  DEMO_REQUESTS,
  getDepartment as getDemoDepartment,
  type DemoRequest,
} from "@/lib/demo";
import { dateShort, titleCase } from "@/lib/format";
import { getRepository } from "@/db/createRepository";
import type { RequestStatus } from "@/domain/requestLifecycle";
import { isTaskTerminal, type TaskStatus } from "@/domain/taskWorkflow";
import type {
  Department,
  EventEntity,
  Repository,
  RequestEntity,
  TaskEntity,
} from "@/services/repository";
const MS_DAY = 86_400_000;

// --- view models -----------------------------------------------------------

export interface TaskVMData {
  id: string;
  token: string;
  departmentId: string | null;
  deptName: string;
  deptLead: string;
  deptEmail: string;
  scope: string;
  status: TaskStatus;
  dueAt: Date;
  uploads: { name: string; pages: number }[];
  pushbackNote?: string;
}

export interface RequestVM {
  id: string;
  publicId: string;
  requesterName: string;
  requesterType: string;
  status: RequestStatus;
  rawText: string;
  /** Interpreted scope when triage has run; otherwise the raw text. */
  interpretedScope: string;
  recordTypes: string[];
  redFlags: string[];
  complexityScore: number | null;
  receivedAt: Date;
  dueAt: Date;
  /** Terminal-outcome timestamp — drives honest on-time metrics. */
  closedAt: Date | null;
  tasks: TaskVMData[];
  triageReady: boolean;
}

export interface DeptVM {
  id: string;
  name: string;
  lead: string;
  email: string;
}

export interface Workspace {
  source: "live" | "demo";
  agencyId: string | null;
  agencyName: string;
  coordinator: string;
  /** The clock the views compute risk against (fixed for the demo fixture). */
  now: Date;
  requests: RequestVM[];
  departments: DeptVM[];
}

export interface TimelineEvent {
  title: string;
  meta: string;
  tone?: "ai" | "alert";
}

// --- source resolution -----------------------------------------------------

export interface AgencyVM {
  /** Null when serving the unseeded demo fixture. */
  id: string | null;
  slug: string;
  name: string;
  stateCode: string;
  source: "live" | "demo";
}

/**
 * Resolve the tenant for a portal URL. Unknown slug → null (page 404s). The
 * demo fixture only ever stands in for the unseeded Riverton demo agency.
 * Cached per request so layout + page share one lookup.
 */
export const getAgencyForSlug = cache(async (slug: string): Promise<AgencyVM | null> => {
  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  if (agency) {
    return { id: agency.id, slug: agency.slug, name: agency.name, stateCode: agency.stateCode, source: "live" };
  }
  if (slug === DEMO_AGENCY.slug) {
    return { id: null, slug, name: DEMO_AGENCY.name, stateCode: DEMO_AGENCY.state, source: "demo" };
  }
  return null;
});

/** Everything the staff surfaces render, from the DB when seeded, else demo. */
export async function getWorkspace(slug: string): Promise<Workspace | null> {
  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  if (!agency) return slug === DEMO_AGENCY.slug ? demoWorkspace() : null;

  // Four batched queries — no per-request round trips.
  const [requests, allTasks, departments, allRequesters] = await Promise.all([
    repo.listRequests(agency.id),
    repo.listAgencyTasks(agency.id),
    repo.listDepartments(agency.id),
    repo.listRequesters(agency.id),
  ]);

  const deptVMs = departments.map(toDeptVM);
  const deptById = new Map(deptVMs.map((d) => [d.id, d]));
  const requesterById = new Map(allRequesters.map((r) => [r.id, r]));
  const tasksByRequest = new Map<string, TaskEntity[]>();
  for (const t of allTasks) {
    const list = tasksByRequest.get(t.requestId) ?? [];
    list.push(t);
    tasksByRequest.set(t.requestId, list);
  }

  const now = new Date();
  const vms = requests.map((r) => {
    const requester = r.requesterId ? requesterById.get(r.requesterId) : undefined;
    return toRequestVM(r, tasksByRequest.get(r.id) ?? [], deptById, requester?.name ?? null, requester?.type ?? "anonymous", now);
  });

  return {
    source: "live",
    agencyId: agency.id,
    agencyName: agency.name,
    coordinator: "Dana Okafor",
    now,
    requests: vms,
    departments: deptVMs,
  };
}

export interface RequestDetail {
  source: "live" | "demo";
  now: Date;
  departments: DeptVM[];
  request: RequestVM;
  timeline: TimelineEvent[];
}

/**
 * One request with its audit timeline — the detail page's data. Reads only
 * what the page needs (request + its tasks + departments + events, in
 * parallel) rather than assembling the whole workspace.
 */
export async function getRequestDetail(slug: string, id: string): Promise<RequestDetail | null> {
  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);

  if (agency) {
    const request = await repo.getRequest(agency.id, id);
    if (!request) return null; // seeded agency → detail links are live ids
    const [tasks, departments, events, requester] = await Promise.all([
      repo.listTasks(agency.id, id),
      repo.listDepartments(agency.id),
      repo.listEvents(agency.id, id),
      request.requesterId ? repo.getRequester(agency.id, request.requesterId) : Promise.resolve(null),
    ]);
    const deptVMs = departments.map(toDeptVM);
    const now = new Date();
    return {
      source: "live",
      now,
      departments: deptVMs,
      request: toRequestVM(
        request,
        tasks,
        new Map(deptVMs.map((d) => [d.id, d])),
        requester?.name ?? null,
        requester?.type ?? "anonymous",
        now,
      ),
      timeline: events.map(toTimelineEvent),
    };
  }

  if (slug !== DEMO_AGENCY.slug) return null;
  const demo = DEMO_REQUESTS.find((r) => r.id === id);
  if (!demo) return null;
  return {
    source: "demo",
    now: DEMO_NOW,
    departments: DEMO_DEPARTMENTS.map((d) => ({ id: d.id, name: d.name, lead: d.lead, email: d.email })),
    request: demoToVM(demo),
    timeline: demoTimeline(demo),
  };
}

/** Public-id lookup for the requester tracker; live first, demo fallback. */
export async function trackByPublicId(
  slug: string,
  publicId: string,
): Promise<{ publicId: string; status: RequestStatus; receivedAt: Date; dueAt: Date; now: Date } | null> {
  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  if (agency) {
    const r = await repo.findRequestByPublicId(agency.id, publicId.toUpperCase());
    if (r) {
      const now = new Date();
      return {
        publicId: r.publicId,
        status: r.status,
        receivedAt: r.receivedAt ?? r.createdAt,
        dueAt: fallbackDueAt(r),
        now,
      };
    }
  }
  if (slug !== DEMO_AGENCY.slug) return null;
  const demo = DEMO_REQUESTS.find((r) => r.publicId.toLowerCase() === publicId.toLowerCase());
  if (demo) {
    return { publicId: demo.publicId, status: demo.status, receivedAt: demo.receivedAt, dueAt: demo.dueAt, now: DEMO_NOW };
  }
  return null;
}

// --- oversight rollups (pure — shared by live and demo sources) ------------

export interface DeptLoadVM extends DeptVM {
  assigned: number;
  inProgress: number;
  submitted: number;
  pushedBack: number;
  done: number;
  open: number;
}

/** Task load per department — where the bottlenecks are (§8, §11). */
export function workloadFor(departments: DeptVM[], requests: RequestVM[]): DeptLoadVM[] {
  const map = new Map<string, DeptLoadVM>();
  for (const d of departments) {
    map.set(d.id, { ...d, assigned: 0, inProgress: 0, submitted: 0, pushedBack: 0, done: 0, open: 0 });
  }
  for (const r of requests) {
    for (const t of r.tasks) {
      const load = t.departmentId ? map.get(t.departmentId) : undefined;
      if (!load) continue;
      if (t.status === "assigned") load.assigned++;
      else if (t.status === "in_progress") load.inProgress++;
      else if (t.status === "submitted") load.submitted++;
      else if (t.status === "pushed_back") load.pushedBack++;
      else if (t.status === "done") load.done++;
    }
  }
  for (const load of map.values()) load.open = load.assigned + load.inProgress + load.pushedBack;
  return [...map.values()];
}

export interface DecisionVM {
  request: RequestVM;
  reason: string;
  severity: "high" | "med";
}

/** "What needs a leader's decision today" — the top of the management view. */
export function decisionsFor(requests: RequestVM[], now: Date): DecisionVM[] {
  const out: DecisionVM[] = [];
  for (const r of requests) {
    const pushedBack = r.tasks.some((t) => t.status === "pushed_back");
    const submitted = r.tasks.some((t) => t.status === "submitted");
    const dueDays = Math.round((r.dueAt.getTime() - now.getTime()) / MS_DAY);
    if (pushedBack) out.push({ request: r, reason: "A department pushed back — needs your call", severity: "high" });
    else if (dueDays < 0) out.push({ request: r, reason: "Overdue", severity: "high" });
    else if (submitted) out.push({ request: r, reason: "Records submitted — ready for review", severity: "med" });
    else if (r.triageReady) out.push({ request: r, reason: "AI triage ready — review the draft", severity: "med" });
    else if (dueDays <= 1) out.push({ request: r, reason: "Due within a day", severity: "med" });
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
}

// --- mapping ---------------------------------------------------------------

/** A request with no computed statutory deadline still needs a display date. */
function fallbackDueAt(r: RequestEntity): Date {
  return r.statutoryDueAt ?? new Date((r.receivedAt ?? r.createdAt).getTime() + 10 * MS_DAY);
}

function toDeptVM(d: Department): DeptVM {
  const email = d.defaultResponderEmails[0] ?? "";
  return { id: d.id, name: d.name, lead: leadFromEmail(email) ?? d.name, email };
}

/** "mbell@riverton.gov" → "M. Bell" is unknowable; show the mailbox name. */
function leadFromEmail(email: string): string | null {
  const local = email.split("@")[0];
  return local ? local : null;
}

function toRequestVM(
  r: RequestEntity,
  tasks: TaskEntity[],
  deptById: Map<string, DeptVM>,
  requesterName: string | null,
  requesterType: string,
  now: Date,
): RequestVM {
  return {
    id: r.id,
    publicId: r.publicId,
    requesterName: requesterName ?? "Anonymous",
    requesterType,
    status: r.status,
    rawText: r.rawText,
    interpretedScope: r.interpretedScope ?? r.rawText,
    recordTypes: r.recordTypes,
    redFlags: [],
    complexityScore: r.complexityScore,
    receivedAt: r.receivedAt ?? r.createdAt,
    dueAt: fallbackDueAt(r),
    closedAt: r.closedAt,
    // "AI triage done, awaiting review" — a scope draft exists on a request
    // that hasn't moved past review yet.
    triageReady: r.interpretedScope != null && (r.status === "submitted" || r.status === "in_review"),
    tasks: tasks.map((t) => {
      const dept = t.departmentId ? deptById.get(t.departmentId) : undefined;
      return {
        id: t.id,
        token: t.token,
        departmentId: t.departmentId,
        deptName: dept?.name ?? "Department",
        deptLead: dept?.lead ?? "Lead",
        deptEmail: dept?.email ?? "",
        scope: t.scopeText,
        status: t.status,
        dueAt: t.dueAt ?? fallbackDueAt(r),
        uploads: t.uploads.map((u) => ({ name: u.name, pages: u.pages ?? 1 })),
        pushbackNote: t.pushbackNotes ?? undefined,
      };
    }),
  };
}

function toTimelineEvent(e: EventEntity): TimelineEvent {
  const tone =
    e.kind === "ai_action" || e.kind === "agent_action"
      ? ("ai" as const)
      : e.summary.toLowerCase().includes("pushed")
        ? ("alert" as const)
        : undefined;
  return { title: e.summary, meta: `${dateShort(e.createdAt)} · ${titleCase(e.kind)}`, tone };
}

/** Count of a request's tasks a coordinator is still waiting on. */
export function outstandingTasks(r: RequestVM): number {
  return r.tasks.filter((t) => !isTaskTerminal(t.status)).length;
}

// --- demo-fixture source ---------------------------------------------------

function demoWorkspace(): Workspace {
  return {
    source: "demo",
    agencyId: null,
    agencyName: DEMO_AGENCY.name,
    coordinator: DEMO_AGENCY.coordinator,
    now: DEMO_NOW,
    requests: DEMO_REQUESTS.map(demoToVM),
    departments: DEMO_DEPARTMENTS.map((d) => ({ id: d.id, name: d.name, lead: d.lead, email: d.email })),
  };
}

function demoToVM(r: DemoRequest): RequestVM {
  return {
    id: r.id,
    publicId: r.publicId,
    requesterName: r.requesterName,
    requesterType: r.requesterType,
    status: r.status,
    rawText: r.rawText,
    interpretedScope: r.interpretedScope,
    recordTypes: r.recordTypes,
    redFlags: r.redFlags,
    complexityScore: r.complexityScore,
    receivedAt: r.receivedAt,
    dueAt: r.dueAt,
    closedAt: null,
    triageReady: r.triageReady,
    tasks: r.tasks.map((t) => {
      const dept = getDemoDepartment(t.departmentId);
      return {
        id: t.id,
        token: t.token,
        departmentId: t.departmentId,
        deptName: dept?.name ?? "Department",
        deptLead: dept?.lead ?? "Lead",
        deptEmail: dept?.email ?? "",
        scope: t.scope,
        status: t.status,
        dueAt: t.dueAt,
        uploads: t.uploads,
        pushbackNote: t.pushbackNote,
      };
    }),
  };
}

function demoTimeline(r: DemoRequest): TimelineEvent[] {
  const events: TimelineEvent[] = [
    { title: "Request received via portal", meta: `${dateShort(r.receivedAt)} · ${titleCase(r.requesterType)} requester` },
    { title: "AI triage completed", meta: "Interpreted scope + red flags drafted", tone: "ai" },
  ];
  if (r.tasks.length > 0) {
    events.push({
      title: `Routed to ${r.tasks.length} department${r.tasks.length === 1 ? "" : "s"}`,
      meta: "Tasks dispatched",
      tone: "ai",
    });
  }
  for (const t of r.tasks) {
    const dept = getDemoDepartment(t.departmentId)?.name ?? "Department";
    if (t.status === "submitted") events.push({ title: `${dept} submitted records`, meta: `${t.uploads.length} document(s)` });
    if (t.status === "done") events.push({ title: `${dept} records accepted`, meta: "Coordinator review complete" });
    if (t.status === "pushed_back") events.push({ title: `${dept} pushed back`, meta: "Needs coordinator decision", tone: "alert" });
  }
  return events;
}
