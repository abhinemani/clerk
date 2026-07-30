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
  /** scrypt hash; null = no portal account (anonymous/email-only requester). */
  passwordHash?: string | null;
  /** When the email was proven. Claimed history stays hidden until set. */
  emailVerifiedAt?: Date | null;
}

export type StaffRole = "admin" | "coordinator" | "reviewer" | "responder" | "read_only";

/** A staff member of an agency (spec §3 roles). */
export interface UserEntity {
  id: string;
  agencyId: string;
  email: string;
  name: string | null;
  role: StaffRole;
  /** scrypt hash; null = cannot sign in yet (provisioned, no credentials set). */
  passwordHash: string | null;
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
  /** Terminal-outcome timestamp (release approved / denied / withdrawn). */
  closedAt: Date | null;
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

/** Append-only account-administration audit (agency-scoped; spec §10 spirit). */
export interface AdminEventEntity {
  id: string;
  agencyId: string;
  kind: string;
  actorLabel: string;
  summary: string;
  payload?: Record<string, unknown>;
  createdAt: Date;
}

/** One outbox row — every outbound message lands here (dev mailbox). */
export interface DeliveryEntity {
  id: string;
  agencyId: string;
  toEmail: string;
  subject: string;
  body: string;
  kind: string;
  requestId: string | null;
  taskId: string | null;
  createdAt: Date;
}

export type ReviewDecision = "release" | "release_redacted" | "withhold";

/** Per-document release decision (spec §5 Review) — always by a named human. */
export interface ReviewEntity {
  id: string;
  agencyId: string;
  requestId: string;
  documentId: string;
  decision: ReviewDecision;
  /** Exemption short-label for withheld/redacted docs (free text at this stage). */
  exemptionLabel: string | null;
  decidedByUserId: string;
  createdAt: Date;
}

export interface ReleaseArtifactRef {
  blobRef: string;
  filename: string;
  checksum: string;
  documentId?: string;
}

/** An immutable delivery (spec §5 Release) — named approver required. */
export interface ReleaseEntity {
  id: string;
  agencyId: string;
  requestId: string;
  artifacts: ReleaseArtifactRef[];
  responseLetter: string | null;
  visibility: "public" | "private";
  approvedByUserId: string;
  releasedAt: Date;
}

/** An ingestion source (spec §9.1) — carries its own hashed API key. */
export interface SourceEntity {
  id: string;
  agencyId: string;
  name: string;
  type: "api_push" | "webhook" | "file_drop" | "scheduled_pull" | "manual";
  /** sha-256 hex of the source's API key — never the key itself. */
  apiKeyHash: string | null;
  trust: "auto_publish" | "review_queue";
  defaultClassification: "public" | "internal";
}

export type AuthTokenKind = "verify_email" | "reset_requester" | "reset_staff" | "staff_invite";

/** Single-use hashed token for verification / reset / invite links. */
export interface AuthTokenEntity {
  id: string;
  agencyId: string;
  kind: AuthTokenKind;
  subjectId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

// --- port ------------------------------------------------------------------

export interface Repository {
  getAgency(agencyId: string): Promise<Agency | null>;
  getAgencyBySlug(slug: string): Promise<Agency | null>;
  /** Every tenant — platform-operator console only; never expose per-agency. */
  listAgencies(): Promise<Agency[]>;
  createAgency(a: Agency): Promise<Agency>;

  findRequesterByEmail(agencyId: string, email: string): Promise<Requester | null>;
  getRequester(agencyId: string, id: string): Promise<Requester | null>;
  /** All requesters in the agency — batched name resolution for list views. */
  listRequesters(agencyId: string): Promise<Requester[]>;
  createRequester(r: Requester): Promise<Requester>;
  updateRequester(agencyId: string, id: string, patch: Partial<Requester>): Promise<Requester>;

  // Staff accounts (agency-scoped; agency admins manage their own roster).
  findUserByEmail(agencyId: string, email: string): Promise<UserEntity | null>;
  getUser(agencyId: string, id: string): Promise<UserEntity | null>;
  listUsers(agencyId: string): Promise<UserEntity[]>;
  createUser(u: UserEntity): Promise<UserEntity>;
  updateUser(agencyId: string, id: string, patch: Partial<UserEntity>): Promise<UserEntity>;

  /** A signed-in requester's own filings ("my requests"), newest first. */
  listRequestsByRequester(agencyId: string, requesterId: string): Promise<RequestEntity[]>;

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
  /** The public corpus — what the portal archive and answer box may show (§6.7). */
  listPublicDocuments(agencyId: string): Promise<DocumentEntity[]>;
  createDocument(doc: DocumentEntity): Promise<DocumentEntity>;
  /** Attach a document to a request's review set (§5 requestDocuments). */
  linkRequestDocument(agencyId: string, requestId: string, documentId: string): Promise<void>;
  listRequestDocuments(agencyId: string, requestId: string): Promise<DocumentEntity[]>;

  /** One decision per (request, document); re-deciding replaces. */
  upsertReview(r: ReviewEntity): Promise<ReviewEntity>;
  listReviews(agencyId: string, requestId: string): Promise<ReviewEntity[]>;

  createRelease(r: ReleaseEntity): Promise<ReleaseEntity>;
  listReleases(agencyId: string, requestId: string): Promise<ReleaseEntity[]>;

  appendDeflection(d: DeflectionEntity): Promise<DeflectionEntity>;
  listDeflections(agencyId: string): Promise<DeflectionEntity[]>;

  /** Append-only, like appendEvent — never update or delete (§10). */
  appendAdminEvent(e: AdminEventEntity): Promise<AdminEventEntity>;
  listAdminEvents(agencyId: string, limit?: number): Promise<AdminEventEntity[]>;

  createDelivery(d: DeliveryEntity): Promise<DeliveryEntity>;
  listDeliveries(agencyId: string, limit?: number): Promise<DeliveryEntity[]>;

  createAuthToken(t: AuthTokenEntity): Promise<AuthTokenEntity>;
  findAuthTokenByHash(tokenHash: string): Promise<AuthTokenEntity | null>;
  markAuthTokenUsed(id: string, usedAt: Date): Promise<void>;

  createSource(s: SourceEntity): Promise<SourceEntity>;
  /** Key auth for §9.1 push: hash the presented key, look it up per agency. */
  findSourceByApiKeyHash(agencyId: string, apiKeyHash: string): Promise<SourceEntity | null>;
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
  private users = new Map<string, UserEntity>();
  private departments = new Map<string, Department>();
  private requests = new Map<string, RequestEntity>();
  private tasks = new Map<string, TaskEntity>();
  private events: EventEntity[] = [];
  private documents = new Map<string, DocumentEntity>();
  private deflections: DeflectionEntity[] = [];
  private adminEvents: AdminEventEntity[] = [];
  private deliveries: DeliveryEntity[] = [];
  private authTokens = new Map<string, AuthTokenEntity>();
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
  async listAgencies() {
    return [...this.agencies.values()];
  }
  async createAgency(a: Agency) {
    this.agencies.set(a.id, a);
    return a;
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
  async listRequesters(agencyId: string) {
    return [...this.requesters.values()].filter((r) => r.agencyId === agencyId);
  }
  async createRequester(r: Requester) {
    this.requesters.set(r.id, r);
    return r;
  }

  async updateRequester(agencyId: string, id: string, patch: Partial<Requester>) {
    const r = await this.getRequester(agencyId, id);
    if (!r) throw new NotFoundError("Requester", id);
    const updated = { ...r, ...patch, id: r.id, agencyId: r.agencyId };
    this.requesters.set(id, updated);
    return updated;
  }

  async findUserByEmail(agencyId: string, email: string) {
    return (
      [...this.users.values()].find((u) => u.agencyId === agencyId && u.email === email) ?? null
    );
  }
  async getUser(agencyId: string, id: string) {
    const u = this.users.get(id);
    return u && u.agencyId === agencyId ? u : null;
  }
  async listUsers(agencyId: string) {
    return [...this.users.values()].filter((u) => u.agencyId === agencyId);
  }
  async createUser(u: UserEntity) {
    this.users.set(u.id, u);
    return u;
  }
  async updateUser(agencyId: string, id: string, patch: Partial<UserEntity>) {
    const u = await this.getUser(agencyId, id);
    if (!u) throw new NotFoundError("User", id);
    const updated = { ...u, ...patch, id: u.id, agencyId: u.agencyId };
    this.users.set(id, updated);
    return updated;
  }

  async listRequestsByRequester(agencyId: string, requesterId: string) {
    return [...this.requests.values()]
      .filter((r) => r.agencyId === agencyId && r.requesterId === requesterId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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

  async listPublicDocuments(agencyId: string) {
    return [...this.documents.values()]
      .filter((d) => d.agencyId === agencyId && d.classification === "public")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private requestDocs: { agencyId: string; requestId: string; documentId: string }[] = [];
  private reviews = new Map<string, ReviewEntity>();
  private releases: ReleaseEntity[] = [];

  async createDocument(doc: DocumentEntity) {
    this.documents.set(doc.id, doc);
    return doc;
  }
  async linkRequestDocument(agencyId: string, requestId: string, documentId: string) {
    const exists = this.requestDocs.some(
      (l) => l.requestId === requestId && l.documentId === documentId,
    );
    if (!exists) this.requestDocs.push({ agencyId, requestId, documentId });
  }
  async listRequestDocuments(agencyId: string, requestId: string) {
    return this.requestDocs
      .filter((l) => l.agencyId === agencyId && l.requestId === requestId)
      .map((l) => this.documents.get(l.documentId))
      .filter((d): d is DocumentEntity => d != null);
  }

  async upsertReview(r: ReviewEntity) {
    const key = `${r.requestId}:${r.documentId}`;
    const existing = this.reviews.get(key);
    const merged = existing ? { ...r, id: existing.id } : r;
    this.reviews.set(key, merged);
    return merged;
  }
  async listReviews(agencyId: string, requestId: string) {
    return [...this.reviews.values()].filter(
      (r) => r.agencyId === agencyId && r.requestId === requestId,
    );
  }

  async createRelease(r: ReleaseEntity) {
    this.releases.push(r);
    return r;
  }
  async listReleases(agencyId: string, requestId: string) {
    return this.releases.filter((r) => r.agencyId === agencyId && r.requestId === requestId);
  }

  async appendDeflection(d: DeflectionEntity) {
    this.deflections.push(d);
    return d;
  }
  async listDeflections(agencyId: string) {
    return this.deflections.filter((d) => d.agencyId === agencyId);
  }

  async appendAdminEvent(e: AdminEventEntity) {
    this.adminEvents.push(e); // append-only (§10)
    return e;
  }
  async listAdminEvents(agencyId: string, limit = 50) {
    return this.adminEvents
      .filter((e) => e.agencyId === agencyId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async createDelivery(d: DeliveryEntity) {
    this.deliveries.push(d);
    return d;
  }
  async listDeliveries(agencyId: string, limit = 50) {
    return this.deliveries
      .filter((d) => d.agencyId === agencyId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  private sources = new Map<string, SourceEntity>();
  async createSource(s: SourceEntity) {
    this.sources.set(s.id, s);
    return s;
  }
  async findSourceByApiKeyHash(agencyId: string, apiKeyHash: string) {
    return (
      [...this.sources.values()].find(
        (s) => s.agencyId === agencyId && s.apiKeyHash != null && s.apiKeyHash === apiKeyHash,
      ) ?? null
    );
  }

  async createAuthToken(t: AuthTokenEntity) {
    this.authTokens.set(t.id, t);
    return t;
  }
  async findAuthTokenByHash(tokenHash: string) {
    return [...this.authTokens.values()].find((t) => t.tokenHash === tokenHash) ?? null;
  }
  async markAuthTokenUsed(id: string, usedAt: Date) {
    const t = this.authTokens.get(id);
    if (t) this.authTokens.set(id, { ...t, usedAt });
  }
}
