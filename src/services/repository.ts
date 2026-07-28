/**
 * Repository port + in-memory adapter (spec §3, §10).
 *
 * The service layer depends on this interface, not on Drizzle — so use cases are
 * testable without a database and a Postgres-backed adapter can be dropped in
 * later without touching business logic (ports & adapters). Every read is
 * agency-scoped; the in-memory adapter enforces the same tenant isolation the DB
 * layer must (a cross-agency read returns null, never another tenant's row).
 */
import type { RequestStatus } from "@/domain/requestLifecycle";
import type { TaskStatus } from "@/domain/taskWorkflow";

// --- entities (DB-agnostic domain model) -----------------------------------

export interface Agency {
  id: string;
  slug: string;
  name: string;
  stateCode: string;
  observedHolidays: string[];
}

export type RequesterType =
  | "media"
  | "legal"
  | "commercial"
  | "individual"
  | "government"
  | "anonymous";

export interface Requester {
  id: string;
  agencyId: string;
  email: string | null;
  name: string | null;
  type: RequesterType;
}

export interface Department {
  id: string;
  agencyId: string;
  name: string;
  defaultResponderEmails: string[];
}

export interface RequestEntity {
  id: string;
  agencyId: string;
  publicId: string;
  requesterId: string | null;
  status: RequestStatus;
  rawText: string;
  interpretedScope: string | null;
  recordTypes: string[];
  complexityScore: number | null;
  receivedAt: Date | null;
  statutoryDueAt: Date | null;
  createdAt: Date;
}

export interface TaskEntity {
  id: string;
  agencyId: string;
  requestId: string;
  departmentId: string | null;
  scopeText: string;
  status: TaskStatus;
  token: string;
  dueAt: Date | null;
  uploads: { name: string; pages?: number }[];
  pushbackNotes: string | null;
}

export type EventKind =
  | "status_change"
  | "message"
  | "ai_action"
  | "agent_action"
  | "approval"
  | "extension"
  | "delivery"
  | "assignment"
  | "note";

export interface EventEntity {
  id: string;
  agencyId: string;
  requestId: string;
  kind: EventKind;
  actorUserId: string | null;
  summary: string;
  payload?: Record<string, unknown>;
  createdAt: Date;
}

export interface DocumentEntity {
  id: string;
  agencyId: string;
  sourceId: string | null;
  externalSystemId: string | null;
  filename: string | null;
  classification: "public" | "internal";
  recordType: string | null;
  processingStatus: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface DeflectionEntity {
  id: string;
  agencyId: string;
  /** "download" (satisfied without filing) or "scope_down" (narrowed a request). */
  kind: "download" | "scope_down";
  query: string | null;
  documentId: string | null;
  estimatedStaffHoursAvoided: number;
  createdAt: Date;
}

// --- port ------------------------------------------------------------------

export interface Repository {
  getAgency(agencyId: string): Promise<Agency | null>;
  getAgencyBySlug(slug: string): Promise<Agency | null>;

  findRequesterByEmail(agencyId: string, email: string): Promise<Requester | null>;
  getRequester(agencyId: string, id: string): Promise<Requester | null>;
  createRequester(r: Requester): Promise<Requester>;

  listDepartments(agencyId: string): Promise<Department[]>;

  nextPublicIdSeq(agencyId: string, year: number): Promise<number>;
  createRequest(r: RequestEntity): Promise<RequestEntity>;
  getRequest(agencyId: string, id: string): Promise<RequestEntity | null>;
  /** Public-id lookup for the requester-facing tracker (e.g. "PR-2026-00341"). */
  findRequestByPublicId(agencyId: string, publicId: string): Promise<RequestEntity | null>;
  /** All requests for an agency, newest first — the staff queue. */
  listRequests(agencyId: string): Promise<RequestEntity[]>;
  updateRequest(
    agencyId: string,
    id: string,
    patch: Partial<RequestEntity>,
  ): Promise<RequestEntity>;

  createTask(t: TaskEntity): Promise<TaskEntity>;
  getTask(agencyId: string, id: string): Promise<TaskEntity | null>;
  getTaskByToken(token: string): Promise<TaskEntity | null>;
  listTasks(agencyId: string, requestId: string): Promise<TaskEntity[]>;
  /** Every task in the agency — queue rollups and department workload (§8, §11). */
  listAgencyTasks(agencyId: string): Promise<TaskEntity[]>;
  updateTask(agencyId: string, id: string, patch: Partial<TaskEntity>): Promise<TaskEntity>;

  appendEvent(e: EventEntity): Promise<EventEntity>;
  listEvents(agencyId: string, requestId: string): Promise<EventEntity[]>;

  /** Idempotent on (sourceId, externalSystemId) — re-push updates in place (§9.1). */
  upsertDocumentByExternalId(
    doc: DocumentEntity,
  ): Promise<{ document: DocumentEntity; created: boolean }>;

  appendDeflection(d: DeflectionEntity): Promise<DeflectionEntity>;
  listDeflections(agencyId: string): Promise<DeflectionEntity[]>;
}

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

// --- in-memory adapter -----------------------------------------------------

export class InMemoryRepository implements Repository {
  private agencies = new Map<string, Agency>();
  private requesters = new Map<string, Requester>();
  private departments = new Map<string, Department>();
  private requests = new Map<string, RequestEntity>();
  private tasks = new Map<string, TaskEntity>();
  private events: EventEntity[] = [];
  private documents = new Map<string, DocumentEntity>();
  private deflections: DeflectionEntity[] = [];
  private seqs = new Map<string, number>();

  seedAgency(a: Agency): this {
    this.agencies.set(a.id, a);
    return this;
  }

  seedDepartment(d: Department): this {
    this.departments.set(d.id, d);
    return this;
  }

  async getAgency(agencyId: string) {
    return this.agencies.get(agencyId) ?? null;
  }
  async getAgencyBySlug(slug: string) {
    return [...this.agencies.values()].find((a) => a.slug === slug) ?? null;
  }

  async findRequesterByEmail(agencyId: string, email: string) {
    return (
      [...this.requesters.values()].find(
        (r) => r.agencyId === agencyId && r.email === email,
      ) ?? null
    );
  }
  async getRequester(agencyId: string, id: string) {
    const r = this.requesters.get(id);
    return r && r.agencyId === agencyId ? r : null;
  }
  async createRequester(r: Requester) {
    this.requesters.set(r.id, r);
    return r;
  }

  async listDepartments(agencyId: string) {
    return [...this.departments.values()].filter((d) => d.agencyId === agencyId);
  }

  async nextPublicIdSeq(agencyId: string, year: number) {
    const key = `${agencyId}:${year}`;
    const next = (this.seqs.get(key) ?? 0) + 1;
    this.seqs.set(key, next);
    return next;
  }

  async createRequest(r: RequestEntity) {
    this.requests.set(r.id, r);
    return r;
  }
  async getRequest(agencyId: string, id: string) {
    const r = this.requests.get(id);
    return r && r.agencyId === agencyId ? r : null; // tenant isolation
  }
  async findRequestByPublicId(agencyId: string, publicId: string) {
    return (
      [...this.requests.values()].find(
        (r) => r.agencyId === agencyId && r.publicId === publicId,
      ) ?? null
    );
  }
  async listRequests(agencyId: string) {
    return [...this.requests.values()]
      .filter((r) => r.agencyId === agencyId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async updateRequest(agencyId: string, id: string, patch: Partial<RequestEntity>) {
    const r = await this.getRequest(agencyId, id);
    if (!r) throw new NotFoundError("Request", id);
    const updated = { ...r, ...patch, id: r.id, agencyId: r.agencyId };
    this.requests.set(id, updated);
    return updated;
  }

  async createTask(t: TaskEntity) {
    this.tasks.set(t.id, t);
    return t;
  }
  async getTask(agencyId: string, id: string) {
    const t = this.tasks.get(id);
    return t && t.agencyId === agencyId ? t : null;
  }
  async getTaskByToken(token: string) {
    return [...this.tasks.values()].find((t) => t.token === token) ?? null;
  }
  async listTasks(agencyId: string, requestId: string) {
    return [...this.tasks.values()].filter(
      (t) => t.agencyId === agencyId && t.requestId === requestId,
    );
  }
  async listAgencyTasks(agencyId: string) {
    return [...this.tasks.values()].filter((t) => t.agencyId === agencyId);
  }
  async updateTask(agencyId: string, id: string, patch: Partial<TaskEntity>) {
    const t = await this.getTask(agencyId, id);
    if (!t) throw new NotFoundError("Task", id);
    const updated = { ...t, ...patch, id: t.id, agencyId: t.agencyId };
    this.tasks.set(id, updated);
    return updated;
  }

  async appendEvent(e: EventEntity) {
    this.events.push(e); // append-only: never mutate or remove (§10)
    return e;
  }
  async listEvents(agencyId: string, requestId: string) {
    return this.events
      .filter((e) => e.agencyId === agencyId && e.requestId === requestId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async upsertDocumentByExternalId(doc: DocumentEntity) {
    const existing = [...this.documents.values()].find(
      (d) =>
        d.agencyId === doc.agencyId &&
        d.sourceId === doc.sourceId &&
        d.externalSystemId != null &&
        d.externalSystemId === doc.externalSystemId,
    );
    if (existing) {
      const merged = { ...existing, ...doc, id: existing.id, createdAt: existing.createdAt };
      this.documents.set(existing.id, merged);
      return { document: merged, created: false };
    }
    this.documents.set(doc.id, doc);
    return { document: doc, created: true };
  }

  async appendDeflection(d: DeflectionEntity) {
    this.deflections.push(d);
    return d;
  }
  async listDeflections(agencyId: string) {
    return this.deflections.filter((d) => d.agencyId === agencyId);
  }
}
