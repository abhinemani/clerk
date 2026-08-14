/**
 * Repository port + in-memory adapter (spec §3, §10).
 *
 * The service layer depends on this interface, not on Drizzle — so use cases are
 * testable without a database and a Postgres-backed adapter can be dropped in
 * later without touching business logic (ports & adapters). Every read is
 * agency-scoped; the in-memory adapter enforces the same tenant isolation the DB
 * layer must (a cross-agency read returns null, never another tenant's row).
 */
import type { AgentBudgetLimits, AgentBudgetSpend, AgentPlanState, PlayStats } from "@/db/schema";
import type { RequestStatus } from "@/domain/requestLifecycle";
import type { TaskStatus } from "@/domain/taskWorkflow";
import type { RoutingRule, WorkflowSettings } from "@/domain/workflow";

// --- entities (DB-agnostic domain model) -----------------------------------

/** Agency settings — mirrors the schema's AgencySettings. All optional. */
export interface AgencySettings {
  publicRequestLog?: boolean;
  statuteReview?: { reviewedBy: string; reviewedOn: string; note?: string };
  statusApi?: { enabled: boolean; webhookUrl?: string | null };
  requesterApi?: { enabled: boolean; filingEnabled?: boolean };
  releaseVerification?: { enabled: boolean };
}

/** Per-tenant identity — mirrors the schema's AgencyBranding. All optional. */
export interface AgencyBranding {
  officeName?: string;
  contactEmail?: string;
  addressLines?: string[];
  hours?: string;
  accentColor?: string;
  sealBlobRef?: string;
}

export interface Agency {
  id: string;
  slug: string;
  name: string;
  stateCode: string;
  observedHolidays: string[];
  /** Opt-in automation policy (src/domain/workflow.ts); absent = fully manual. */
  workflowSettings?: WorkflowSettings | null;
  /** Deterministic keyword→department routing (src/domain/workflow.ts). */
  defaultRoutingRules?: RoutingRule[] | null;
  /** Portal identity (seal, accent, office contact); null = defaults. */
  branding?: AgencyBranding | null;
  /** Transparency log toggle + counsel sign-off; null = defaults. */
  settings?: AgencySettings | null;
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

/**
 * One side of a cross-tenant forward — mirrors the schema's ForwardLink.
 * Denormalized on purpose: everything needed to display "forwarded to/from X"
 * is snapshotted at forward time so no read ever crosses tenants.
 */
export interface ForwardLink {
  agencyId: string;
  agencySlug: string;
  agencyName: string;
  requestId: string;
  publicId: string;
  at: string; // ISO timestamp
}

/** One taken statutory extension (§7) — mirrors the schema's ExtensionRecord. */
export interface ExtensionEntry {
  at: string; // ISO timestamp
  byUserId: string;
  days: number;
  reason: string;
  statutoryBasis?: string;
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
  /** Extensions taken, oldest first (invariant 7: every deadline has a basis). */
  extensionHistory?: ExtensionEntry[];
  /** Owning coordinator (§6.3 queue ergonomics); null = unassigned. */
  assignedCoordinatorId?: string | null;
  /** Referral: which directory entry the requester was pointed at, and when. */
  referredToDirectoryId?: string | null;
  referredAt?: Date | null;
  /** Cross-tenant forwarding (referral phase 3) — denormalized snapshots so
      display never reads the other tenant. See schema.ts ForwardLink. */
  forwardedFrom?: ForwardLink | null;
  forwardedTo?: ForwardLink | null;
  /** Terminal-outcome timestamp (release approved / denied / withdrawn). */
  closedAt: Date | null;
  createdAt: Date;
}

/** A neighboring agency this tenant can refer requests to. */
export interface DirectoryEntry {
  id: string;
  agencyId: string;
  name: string;
  jurisdictionType:
    | "city" | "county" | "state" | "federal"
    | "school_district" | "special_district" | "court" | "other";
  contactEmail: string | null;
  contactPhone: string | null;
  portalUrl: string | null;
  recordTypes: string[];
  notes: string | null;
  /** Set when this target is another Brandeis tenant (enables forwarding). */
  peerAgencyId: string | null;
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
  /** How the document arrived (schema enum); adapters default responder_upload. */
  provenance?: "responder_upload" | "staff_upload" | "email_ingest" | "connector" | "prior_release";
  filename: string | null;
  classification: "public" | "internal";
  recordType: string | null;
  processingStatus: string;
  metadata: Record<string, unknown> | null;
  /** Object-storage key when real bytes exist (null for metadata-only entries). */
  blobRef?: string | null;
  byteSize?: number | null;
  mimeType?: string | null;
  /** sha-256 hex of the stored bytes. */
  checksum?: string | null;
  /** Text rendition (extraction at ingest, §6.5) — what redaction operates on. */
  extractedText?: string | null;
  pageCount?: number | null;
  /** Agency retention schedule date ("destroy after"); null = unscheduled. */
  retentionUntil?: Date | null;
  /** Non-null = do not destroy, whatever the schedule says (§ retention). */
  legalHoldReason?: string | null;
  createdAt: Date;
}

/**
 * A learned demand cluster with its resolution statistics (docs/
 * learning-loop.md). Rows are a nightly-rebuilt materialized aggregate —
 * replaced wholesale per agency, never mutated row-by-row.
 */
export interface PlayEntity {
  id: string;
  agencyId: string;
  topic: string;
  keywords: string[];
  stats: PlayStats;
  episodeCount: number;
  rebuiltAt: Date;
  createdAt: Date;
}

/** DB enum agent_type — the five §16.1 agents (Phase-5 additions need a migration). */
export type PersistedAgentType =
  | "fulfillment"
  | "deadline"
  | "release_prep"
  | "ingest_steward"
  | "requester_side";

export type AgentRunStatus =
  | "planning"
  | "running"
  | "paused"
  | "awaiting_checkpoint"
  | "completed"
  | "exhausted"
  | "failed"
  | "cancelled";

/** A persisted agent run (§16.2) — resumable, interruptible, human-steerable. */
export interface AgentRunEntity {
  id: string;
  agencyId: string;
  agentType: PersistedAgentType;
  requestId: string | null;
  status: AgentRunStatus;
  goal: string;
  plan: AgentPlanState | null;
  budgetLimits: AgentBudgetLimits | null;
  budgetSpend: AgentBudgetSpend | null;
  /** Null = system/cron initiated (e.g. the nightly deadline sweep). */
  startedByUserId: string | null;
  pausedByUserId?: string | null;
  handoffNote: string | null;
  lastStepAt: Date | null;
  createdAt: Date;
}

export interface DeflectionEntity {
  id: string;
  agencyId: string;
  /** "download" (satisfied without filing), "scope_down" (narrowed a request),
      "answered_by_link" (a FILED request closed by citing already-public
      records — production avoided, not filing), or "archive_miss" (searched,
      found nothing, filed anyway — unmet demand, 0 hours avoided; the
      disclosure librarian's raw signal, not an ROI event). */
  kind: "download" | "scope_down" | "answered_by_link" | "archive_miss";
  query: string | null;
  documentId: string | null;
  estimatedStaffHoursAvoided: number;
  createdAt: Date;
}

export type JobStatus = "queued" | "running" | "done" | "failed";

/** One durable background job — survives restarts; failures stay visible. */
export interface JobRecord {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  /** Incremented on claim — attempt 1 is the first run. */
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  /** Not runnable before this moment (retry backoff). */
  runAfter: Date;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  createdAt: Date;
}

export type PublicationDecisionKind = "published" | "kept_internal" | "unpublished";

/** The publication queue's three tabs (docs/records-ingestion.md §2). */
export type PublicationState = "undecided" | "published" | "kept_internal";

/**
 * One publish / keep-internal / unpublish act on a corpus document — the
 * append-only history behind the jsonb `metadata.publicationDecision` cache.
 * Insert-only, like request/admin events; documentId has no FK on purpose
 * (an audit row outlives the document).
 */
export interface PublicationDecisionRow {
  id: string;
  agencyId: string;
  documentId: string;
  decision: PublicationDecisionKind;
  byUserId: string;
  byName: string;
  /** Mandatory for unpublish; null otherwise. */
  reason: string | null;
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
  /** null = outbox-only mode; "relayed" | "failed" after a provider attempt. */
  relayStatus?: "relayed" | "failed" | null;
  relayError?: string | null;
  createdAt: Date;
}

export type MessageDirection = "inbound" | "outbound" | "internal_note";

/**
 * One correspondence entry on a request (§5 messages). Outbound messages
 * always carry `sentByUserId` — no message reaches a requester without a named
 * human (§10); inbound messages are the requester's own words (no user id).
 */
export interface MessageEntity {
  id: string;
  agencyId: string;
  requestId: string;
  direction: MessageDirection;
  channel: "portal" | "email";
  subject: string | null;
  body: string;
  aiDrafted: boolean;
  sentByUserId: string | null;
  sentAt: Date;
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
  /**
   * CONNECTED-SOURCE fields (docs/connected-sources.md), optional so the
   * plain ingestion sources (API push, lazy file drop) keep their slim
   * shape. connectorKind non-null marks a connected data source — e.g.
   * "dataset_file_drop" — and distinguishes it from the records-import
   * "File drop" source, which shares type "file_drop" but has no connector.
   */
  connectorKind?: string | null;
  /** Human-readable cadence ("nightly"); null = paused. */
  syncSchedule?: string | null;
  /** Connector configuration (never secrets — same rule as credentialsRef). */
  mappingConfig?: Record<string, unknown> | null;
  lastSyncAt?: Date | null;
  lastSyncStatus?: "never" | "ok" | "running" | "error";
  lastSyncError?: string | null;
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
  /** Settings-only patch (workflow policy etc.) — identity fields are fixed. */
  updateAgency(
    agencyId: string,
    patch: Partial<Pick<Agency, "workflowSettings" | "defaultRoutingRules" | "branding" | "settings">>,
  ): Promise<Agency>;

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
  createDepartment(d: Department): Promise<Department>;
  updateDepartment(
    agencyId: string,
    id: string,
    patch: Partial<Omit<Department, "id" | "agencyId">>,
  ): Promise<Department>;
  /** Departments a staff member belongs to (responder scoping). */
  listUserDepartmentIds(agencyId: string, userId: string): Promise<string[]>;
  /** Replace a staff member's department memberships (admin act). */
  setUserDepartments(agencyId: string, userId: string, departmentIds: string[]): Promise<void>;

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
  /**
   * Store the request's ask vector (answer-first phase 4). Written
   * best-effort at submit and by the embed_requests backfill; read by
   * precedent retrieval for RAG'd triage. Kept off RequestEntity on purpose
   * — a 1024-float column has no business riding along on every list/get.
   */
  setRequestEmbedding(agencyId: string, id: string, embedding: number[]): Promise<void>;
  /** Every stored ask vector for the agency (ids + vectors only). */
  listRequestEmbeddings(agencyId: string): Promise<{ id: string; embedding: number[] }[]>;

  listDirectory(agencyId: string): Promise<DirectoryEntry[]>;
  getDirectoryEntry(agencyId: string, id: string): Promise<DirectoryEntry | null>;
  createDirectoryEntry(e: DirectoryEntry): Promise<DirectoryEntry>;
  updateDirectoryEntry(
    agencyId: string,
    id: string,
    patch: Partial<Omit<DirectoryEntry, "id" | "agencyId">>,
  ): Promise<DirectoryEntry>;
  deleteDirectoryEntry(agencyId: string, id: string): Promise<void>;

  createTask(t: TaskEntity): Promise<TaskEntity>;
  getTask(agencyId: string, id: string): Promise<TaskEntity | null>;
  getTaskByToken(token: string): Promise<TaskEntity | null>;
  /**
   * Credential-style lookup for email ingest (§6.5): the random request UUID
   * in a `req-{id}@` ingest address plays the same role as a task token.
   * Never expose through a user-facing surface.
   */
  getRequestByIngestId(requestId: string): Promise<RequestEntity | null>;
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
  /** Every document in the agency corpus — STAFF surfaces only (§6.4). */
  listDocuments(agencyId: string): Promise<DocumentEntity[]>;
  /** Documents with a retention schedule or a legal hold — the retention sweep's working set. */
  listDocumentsUnderRetention(agencyId: string): Promise<DocumentEntity[]>;
  createDocument(doc: DocumentEntity): Promise<DocumentEntity>;
  getDocument(agencyId: string, id: string): Promise<DocumentEntity | null>;
  /**
   * Narrow patch for pipeline outputs (metadata, processing status). NEVER
   * use to flip classification internal→public — that direction requires a
   * named human at the service layer (invariant 9).
   */
  updateDocument(
    agencyId: string,
    id: string,
    patch: Partial<
      Pick<
        DocumentEntity,
        "metadata" | "processingStatus" | "extractedText" | "pageCount" | "retentionUntil" | "legalHoldReason"
      >
    >,
  ): Promise<DocumentEntity>;
  /** Store a document's search embedding (chunk 0 in document_chunks). */
  setDocumentEmbedding(agencyId: string, id: string, embedding: number[], content: string): Promise<void>;
  /**
   * Replace a document's body chunks (chunk 1+; chunk 0 stays the archive
   * entry vector). STAFF-scope search reads these — they cover internal
   * documents, so no requester-facing surface may ever query them.
   */
  setDocumentBodyChunks(
    agencyId: string,
    documentId: string,
    chunks: { content: string; embedding: number[] }[],
  ): Promise<void>;
  /** Body chunks across the agency corpus — staff hybrid search (§6.4). */
  listBodyChunkEmbeddings(
    agencyId: string,
  ): Promise<{ documentId: string; chunkIndex: number; content: string; embedding: number[] }[]>;
  /** Document ids that already have body chunks — lets the job skip them. */
  listDocumentIdsWithBodyChunks(agencyId: string): Promise<string[]>;
  /** Public docs that already have embeddings — the vector half of hybrid search. */
  listPublicDocumentEmbeddings(agencyId: string): Promise<{ id: string; embedding: number[] }[]>;
  /** Attach a document to a request's review set (§5 requestDocuments). */
  linkRequestDocument(agencyId: string, requestId: string, documentId: string): Promise<void>;
  listRequestDocuments(agencyId: string, requestId: string): Promise<DocumentEntity[]>;
  /** The release (if any) whose frozen artifact list contains this document. */
  findReleaseContainingDocument(agencyId: string, documentId: string): Promise<ReleaseEntity | null>;
  /**
   * Newest document carrying this external id (sourceId-less). Re-finalizing a
   * redaction creates a NEW artifact under the same id — latest wins, prior
   * versions stay immutable (invariant 8 spirit).
   */
  findLatestDocumentByExternalId(agencyId: string, externalSystemId: string): Promise<DocumentEntity | null>;

  createMessage(m: MessageEntity): Promise<MessageEntity>;
  /** A request's correspondence thread, oldest first. */
  listMessages(agencyId: string, requestId: string): Promise<MessageEntity[]>;

  /** One decision per (request, document); re-deciding replaces. */
  upsertReview(r: ReviewEntity): Promise<ReviewEntity>;
  listReviews(agencyId: string, requestId: string): Promise<ReviewEntity[]>;
  /** Every review decision in the agency — reporting counts exemption citations from here. */
  listAgencyReviews(agencyId: string): Promise<ReviewEntity[]>;

  createRelease(r: ReleaseEntity): Promise<ReleaseEntity>;
  listReleases(agencyId: string, requestId: string): Promise<ReleaseEntity[]>;
  /** Every release the agency has ever made, newest first — the verification
   *  register's read (docs/release-verification.md). */
  listAllReleases(agencyId: string): Promise<ReleaseEntity[]>;
  /** Release by id — resolves an archive entry back to its frozen artifacts. */
  getReleaseById(agencyId: string, releaseId: string): Promise<ReleaseEntity | null>;

  appendDeflection(d: DeflectionEntity): Promise<DeflectionEntity>;
  listDeflections(agencyId: string): Promise<DeflectionEntity[]>;

  // Learning loop (docs/learning-loop.md): plays are replaced wholesale
  // per agency by the nightly rebuild — full-replace semantics on purpose,
  // so the store can never drift from the record it summarizes.
  replaceAgencyPlays(agencyId: string, rows: PlayEntity[]): Promise<void>;
  listPlays(agencyId: string): Promise<PlayEntity[]>;

  // Agent runs (§16.2): persisted plan state so runs are resumable and a
  // human can steer any run from the UI. All reads agency-scoped.
  createAgentRun(r: AgentRunEntity): Promise<AgentRunEntity>;
  getAgentRun(agencyId: string, id: string): Promise<AgentRunEntity | null>;
  updateAgentRun(
    agencyId: string,
    id: string,
    patch: Partial<
      Pick<
        AgentRunEntity,
        "status" | "plan" | "budgetSpend" | "handoffNote" | "lastStepAt" | "pausedByUserId"
      >
    >,
  ): Promise<AgentRunEntity>;
  listAgentRuns(agencyId: string): Promise<AgentRunEntity[]>;

  // Durable job queue (deployment-scoped — payloads carry agency ids).
  createJob(j: JobRecord): Promise<JobRecord>;
  /** Atomically claim the oldest runnable job: → running, attempts+1. */
  claimNextJob(now: Date): Promise<JobRecord | null>;
  completeJob(id: string, at: Date): Promise<void>;
  /** Back on the queue with a later runAfter (retry with backoff). */
  retryJob(id: string, error: string, runAfter: Date): Promise<void>;
  /** Terminal failure — stays visible for the operator health surface. */
  markJobFailed(id: string, error: string, at: Date): Promise<void>;
  /** Boot recovery: jobs a dead process left "running" go back to queued. */
  resetRunningJobs(): Promise<number>;
  listJobs(opts?: { status?: JobStatus; limit?: number }): Promise<JobRecord[]>;

  /** Append-only, like appendEvent — never update or delete (§10). */
  appendAdminEvent(e: AdminEventEntity): Promise<AdminEventEntity>;
  listAdminEvents(agencyId: string, limit?: number): Promise<AdminEventEntity[]>;

  /** Append-only publication history — insert only, no update/delete paths. */
  appendPublicationDecision(d: PublicationDecisionRow): Promise<PublicationDecisionRow>;
  /** Newest first; documentId narrows to one document's history. */
  listPublicationDecisions(agencyId: string, documentId?: string): Promise<PublicationDecisionRow[]>;

  createDelivery(d: DeliveryEntity): Promise<DeliveryEntity>;
  listDeliveries(agencyId: string, limit?: number): Promise<DeliveryEntity[]>;
  /** Record the relay outcome on an outbox row (health surface reads "failed"). */
  updateDeliveryRelay(id: string, status: "relayed" | "failed", error?: string): Promise<void>;
  /** Deployment-wide failed relays, newest first — operator health surface. */
  listFailedDeliveries(limit?: number): Promise<DeliveryEntity[]>;

  createAuthToken(t: AuthTokenEntity): Promise<AuthTokenEntity>;
  findAuthTokenByHash(tokenHash: string): Promise<AuthTokenEntity | null>;
  markAuthTokenUsed(id: string, usedAt: Date): Promise<void>;

  createSource(s: SourceEntity): Promise<SourceEntity>;
  /** Key auth for §9.1 push: hash the presented key, look it up per agency. */
  findSourceByApiKeyHash(agencyId: string, apiKeyHash: string): Promise<SourceEntity | null>;
  /** The agency's ingestion sources — source-management UI + lazy file-drop lookup. */
  listSources(agencyId: string): Promise<SourceEntity[]>;
  /** Trust/classification policy changes and key rotation (audited at the service layer). */
  updateSource(
    agencyId: string,
    id: string,
    patch: Partial<
      Pick<
        SourceEntity,
        | "name"
        | "trust"
        | "defaultClassification"
        | "apiKeyHash"
        | "syncSchedule"
        | "mappingConfig"
        | "lastSyncAt"
        | "lastSyncStatus"
        | "lastSyncError"
      >
    >,
  ): Promise<SourceEntity>;
  /**
   * Remove a source registration. Documents SURVIVE (documents.source_id is
   * on-delete-set-null): deleting a connected source stops future syncs but
   * never removes anything from the corpus or the archive — unpublishing
   * stays the audited emergency-unpublish path (docs/connected-sources.md).
   */
  deleteSource(agencyId: string, id: string): Promise<void>;

  /** Document ids attached to ANY request — those belong to the request review flow. */
  listAttachedDocumentIds(agencyId: string): Promise<string[]>;
  /**
   * Publication-queue tab counts, computed at the query layer — the queue
   * must not load the whole corpus to render three pills. States share the
   * queue's eligibility rule: unattached, non-release-artifact documents.
   */
  countPublicationStates(agencyId: string): Promise<Record<PublicationState, number>>;
  /**
   * One publication-queue page, newest first, keyset-paginated on
   * (createdAt, id) — `before` is the last row of the previous page.
   */
  listPublicationDocuments(
    agencyId: string,
    state: PublicationState,
    opts: { limit: number; before?: { createdAt: Date; id: string } },
  ): Promise<DocumentEntity[]>;
  /**
   * The ONE way a document's classification changes after creation. Only the
   * publication service may call it (invariant 4/9: internal→public is a named
   * human's decision, audited there) — never pipelines or jobs.
   */
  setDocumentClassification(
    agencyId: string,
    id: string,
    classification: "public" | "internal",
  ): Promise<DocumentEntity>;
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
  async updateAgency(
    agencyId: string,
    patch: Partial<Pick<Agency, "workflowSettings" | "defaultRoutingRules" | "branding" | "settings">>,
  ) {
    const a = this.agencies.get(agencyId);
    if (!a) throw new NotFoundError("Agency", agencyId);
    const updated = { ...a, ...patch };
    this.agencies.set(agencyId, updated);
    return updated;
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
  async createDepartment(d: Department) {
    this.departments.set(d.id, d);
    return d;
  }
  async updateDepartment(agencyId: string, id: string, patch: Partial<Omit<Department, "id" | "agencyId">>) {
    const d = this.departments.get(id);
    if (!d || d.agencyId !== agencyId) throw new NotFoundError("Department", id);
    const updated = { ...d, ...patch, id: d.id, agencyId: d.agencyId };
    this.departments.set(id, updated);
    return updated;
  }

  private userDepartments = new Map<string, Set<string>>();
  async listUserDepartmentIds(agencyId: string, userId: string) {
    const user = this.users.get(userId);
    if (!user || user.agencyId !== agencyId) return []; // tenant isolation
    return [...(this.userDepartments.get(userId) ?? [])];
  }
  async setUserDepartments(agencyId: string, userId: string, departmentIds: string[]) {
    const user = this.users.get(userId);
    if (!user || user.agencyId !== agencyId) throw new NotFoundError("User", userId);
    // Only this agency's departments can be attached — a cross-tenant id is a bug.
    const valid = new Set(
      [...this.departments.values()].filter((d) => d.agencyId === agencyId).map((d) => d.id),
    );
    this.userDepartments.set(userId, new Set(departmentIds.filter((id) => valid.has(id))));
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
  private requestEmbeddings = new Map<string, number[]>();
  async setRequestEmbedding(agencyId: string, id: string, embedding: number[]) {
    const r = this.requests.get(id);
    if (!r || r.agencyId !== agencyId) throw new NotFoundError("Request", id);
    this.requestEmbeddings.set(id, embedding);
  }
  async listRequestEmbeddings(agencyId: string) {
    const out: { id: string; embedding: number[] }[] = [];
    for (const [id, embedding] of this.requestEmbeddings) {
      const r = this.requests.get(id);
      if (r && r.agencyId === agencyId) out.push({ id, embedding });
    }
    return out;
  }
  async updateRequest(agencyId: string, id: string, patch: Partial<RequestEntity>) {
    const r = await this.getRequest(agencyId, id);
    if (!r) throw new NotFoundError("Request", id);
    const updated = { ...r, ...patch, id: r.id, agencyId: r.agencyId };
    this.requests.set(id, updated);
    return updated;
  }

  private directory = new Map<string, DirectoryEntry>();
  seedDirectoryEntry(e: DirectoryEntry): this {
    this.directory.set(e.id, e);
    return this;
  }
  async listDirectory(agencyId: string) {
    return [...this.directory.values()]
      .filter((e) => e.agencyId === agencyId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  async getDirectoryEntry(agencyId: string, id: string) {
    const e = this.directory.get(id);
    return e && e.agencyId === agencyId ? e : null;
  }
  async createDirectoryEntry(e: DirectoryEntry) {
    this.directory.set(e.id, e);
    return e;
  }
  async updateDirectoryEntry(
    agencyId: string,
    id: string,
    patch: Partial<Omit<DirectoryEntry, "id" | "agencyId">>,
  ) {
    const e = await this.getDirectoryEntry(agencyId, id);
    if (!e) throw new NotFoundError("DirectoryEntry", id);
    const updated = { ...e, ...patch };
    this.directory.set(id, updated);
    return updated;
  }
  async deleteDirectoryEntry(agencyId: string, id: string) {
    const e = await this.getDirectoryEntry(agencyId, id);
    if (e) this.directory.delete(id);
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
  async getRequestByIngestId(requestId: string) {
    return this.requests.get(requestId) ?? null;
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

  async listDocuments(agencyId: string) {
    return [...this.documents.values()]
      .filter((d) => d.agencyId === agencyId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listDocumentsUnderRetention(agencyId: string) {
    return [...this.documents.values()]
      .filter((d) => d.agencyId === agencyId && (d.retentionUntil != null || d.legalHoldReason != null))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private requestDocs: { agencyId: string; requestId: string; documentId: string }[] = [];
  private reviews = new Map<string, ReviewEntity>();
  private releases: ReleaseEntity[] = [];

  async createDocument(doc: DocumentEntity) {
    this.documents.set(doc.id, doc);
    return doc;
  }
  async getDocument(agencyId: string, id: string) {
    const d = this.documents.get(id);
    return d && d.agencyId === agencyId ? d : null;
  }
  async updateDocument(
    agencyId: string,
    id: string,
    patch: Partial<Pick<DocumentEntity, "metadata" | "processingStatus" | "extractedText" | "pageCount">>,
  ) {
    const d = await this.getDocument(agencyId, id);
    if (!d) throw new NotFoundError("Document", id);
    const updated = { ...d, ...patch, id: d.id, agencyId: d.agencyId };
    this.documents.set(id, updated);
    return updated;
  }

  private embeddings = new Map<string, number[]>();
  async setDocumentEmbedding(agencyId: string, id: string, embedding: number[], content: string) {
    void content;
    const d = await this.getDocument(agencyId, id);
    if (!d) throw new NotFoundError("Document", id);
    this.embeddings.set(id, embedding);
  }
  private bodyChunks = new Map<string, { content: string; embedding: number[] }[]>();
  async setDocumentBodyChunks(
    agencyId: string,
    documentId: string,
    chunks: { content: string; embedding: number[] }[],
  ) {
    const d = await this.getDocument(agencyId, documentId);
    if (!d) throw new NotFoundError("Document", documentId);
    this.bodyChunks.set(documentId, chunks);
  }
  async listBodyChunkEmbeddings(agencyId: string) {
    const out: { documentId: string; chunkIndex: number; content: string; embedding: number[] }[] = [];
    for (const [documentId, chunks] of this.bodyChunks) {
      const d = this.documents.get(documentId);
      if (!d || d.agencyId !== agencyId) continue;
      chunks.forEach((c, i) =>
        out.push({ documentId, chunkIndex: i + 1, content: c.content, embedding: c.embedding }),
      );
    }
    return out;
  }
  async listDocumentIdsWithBodyChunks(agencyId: string) {
    return [...this.bodyChunks.keys()].filter((id) => this.documents.get(id)?.agencyId === agencyId);
  }
  async listPublicDocumentEmbeddings(agencyId: string) {
    const out: { id: string; embedding: number[] }[] = [];
    for (const d of this.documents.values()) {
      if (d.agencyId !== agencyId || d.classification !== "public") continue;
      const embedding = this.embeddings.get(d.id);
      if (embedding) out.push({ id: d.id, embedding });
    }
    return out;
  }
  async findReleaseContainingDocument(agencyId: string, documentId: string) {
    return (
      this.releases.find(
        (r) => r.agencyId === agencyId && r.artifacts.some((a) => a.documentId === documentId),
      ) ?? null
    );
  }
  async findLatestDocumentByExternalId(agencyId: string, externalSystemId: string) {
    // Later insertion wins createdAt ties (Map preserves insertion order).
    let latest: DocumentEntity | null = null;
    for (const d of this.documents.values()) {
      if (d.agencyId !== agencyId || d.externalSystemId !== externalSystemId) continue;
      if (!latest || d.createdAt.getTime() >= latest.createdAt.getTime()) latest = d;
    }
    return latest;
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

  private messages: MessageEntity[] = [];

  async createMessage(m: MessageEntity) {
    this.messages.push(m);
    return m;
  }
  async listMessages(agencyId: string, requestId: string) {
    return this.messages
      .filter((m) => m.agencyId === agencyId && m.requestId === requestId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
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
  async listAgencyReviews(agencyId: string) {
    return [...this.reviews.values()].filter((r) => r.agencyId === agencyId);
  }

  async createRelease(r: ReleaseEntity) {
    this.releases.push(r);
    return r;
  }
  async listReleases(agencyId: string, requestId: string) {
    return this.releases.filter((r) => r.agencyId === agencyId && r.requestId === requestId);
  }
  async listAllReleases(agencyId: string) {
    return this.releases
      .filter((r) => r.agencyId === agencyId)
      .sort((a, b) => b.releasedAt.getTime() - a.releasedAt.getTime());
  }
  async getReleaseById(agencyId: string, releaseId: string) {
    return this.releases.find((r) => r.agencyId === agencyId && r.id === releaseId) ?? null;
  }

  async appendDeflection(d: DeflectionEntity) {
    this.deflections.push(d);
    return d;
  }
  async listDeflections(agencyId: string) {
    return this.deflections.filter((d) => d.agencyId === agencyId);
  }

  private plays: PlayEntity[] = [];

  async replaceAgencyPlays(agencyId: string, rows: PlayEntity[]) {
    this.plays = [
      ...this.plays.filter((p) => p.agencyId !== agencyId),
      ...rows.filter((p) => p.agencyId === agencyId),
    ];
  }
  async listPlays(agencyId: string) {
    return this.plays
      .filter((p) => p.agencyId === agencyId)
      .sort((a, b) => b.episodeCount - a.episodeCount);
  }

  private agentRuns = new Map<string, AgentRunEntity>();

  async createAgentRun(r: AgentRunEntity) {
    this.agentRuns.set(r.id, { ...r });
    return r;
  }
  async getAgentRun(agencyId: string, id: string) {
    const run = this.agentRuns.get(id);
    return run && run.agencyId === agencyId ? run : null;
  }
  async updateAgentRun(
    agencyId: string,
    id: string,
    patch: Partial<
      Pick<
        AgentRunEntity,
        "status" | "plan" | "budgetSpend" | "handoffNote" | "lastStepAt" | "pausedByUserId"
      >
    >,
  ) {
    const run = await this.getAgentRun(agencyId, id);
    if (!run) throw new NotFoundError("AgentRun", id);
    const updated = { ...run, ...patch };
    this.agentRuns.set(id, updated);
    return updated;
  }
  async listAgentRuns(agencyId: string) {
    return [...this.agentRuns.values()]
      .filter((r) => r.agencyId === agencyId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private jobs = new Map<string, JobRecord>();
  async createJob(j: JobRecord) {
    this.jobs.set(j.id, j);
    return j;
  }
  async claimNextJob(now: Date) {
    const next = [...this.jobs.values()]
      .filter((j) => j.status === "queued" && j.runAfter.getTime() <= now.getTime())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!next) return null;
    const claimed: JobRecord = { ...next, status: "running", attempts: next.attempts + 1, startedAt: now };
    this.jobs.set(claimed.id, claimed);
    return claimed;
  }
  async completeJob(id: string, at: Date) {
    const j = this.jobs.get(id);
    if (j) this.jobs.set(id, { ...j, status: "done", finishedAt: at });
  }
  async retryJob(id: string, error: string, runAfter: Date) {
    const j = this.jobs.get(id);
    if (j) this.jobs.set(id, { ...j, status: "queued", lastError: error, runAfter });
  }
  async markJobFailed(id: string, error: string, at: Date) {
    const j = this.jobs.get(id);
    if (j) this.jobs.set(id, { ...j, status: "failed", lastError: error, finishedAt: at });
  }
  async resetRunningJobs() {
    let n = 0;
    for (const j of this.jobs.values()) {
      if (j.status === "running") {
        this.jobs.set(j.id, { ...j, status: "queued" });
        n++;
      }
    }
    return n;
  }
  async listJobs(opts?: { status?: JobStatus; limit?: number }) {
    return [...this.jobs.values()]
      .filter((j) => (opts?.status ? j.status === opts.status : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, opts?.limit ?? 100);
  }

  async appendAdminEvent(e: AdminEventEntity) {
    this.adminEvents.push(e); // append-only (§10)
    return e;
  }

  private publicationDecisions: PublicationDecisionRow[] = [];
  async appendPublicationDecision(d: PublicationDecisionRow) {
    this.publicationDecisions.push(d); // append-only
    return d;
  }
  async listPublicationDecisions(agencyId: string, documentId?: string) {
    return this.publicationDecisions
      .filter((d) => d.agencyId === agencyId && (documentId == null || d.documentId === documentId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
  async updateDeliveryRelay(id: string, status: "relayed" | "failed", error?: string) {
    const d = this.deliveries.find((x) => x.id === id);
    if (d) {
      d.relayStatus = status;
      d.relayError = error ?? null;
    }
  }
  async listFailedDeliveries(limit = 50) {
    return this.deliveries
      .filter((d) => d.relayStatus === "failed")
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
  async listSources(agencyId: string) {
    return [...this.sources.values()].filter((s) => s.agencyId === agencyId);
  }
  async updateSource(
    agencyId: string,
    id: string,
    patch: Partial<
      Pick<
        SourceEntity,
        | "name"
        | "trust"
        | "defaultClassification"
        | "apiKeyHash"
        | "syncSchedule"
        | "mappingConfig"
        | "lastSyncAt"
        | "lastSyncStatus"
        | "lastSyncError"
      >
    >,
  ) {
    const s = this.sources.get(id);
    if (!s || s.agencyId !== agencyId) throw new NotFoundError("Source", id);
    const updated = { ...s, ...patch, id: s.id, agencyId: s.agencyId };
    this.sources.set(id, updated);
    return updated;
  }
  async deleteSource(agencyId: string, id: string) {
    const s = this.sources.get(id);
    if (!s || s.agencyId !== agencyId) throw new NotFoundError("Source", id);
    this.sources.delete(id);
    // Documents survive with sourceId detached — mirrors ON DELETE SET NULL.
    for (const [docId, d] of this.documents) {
      if (d.sourceId === id) this.documents.set(docId, { ...d, sourceId: null });
    }
  }

  async listAttachedDocumentIds(agencyId: string) {
    return [...new Set(this.requestDocs.filter((rd) => rd.agencyId === agencyId).map((rd) => rd.documentId))];
  }

  /** The queue's eligibility + state predicate — mirrors the Drizzle SQL. */
  private publicationStateDocs(agencyId: string, state: PublicationState): DocumentEntity[] {
    const attached = new Set(this.requestDocs.filter((rd) => rd.agencyId === agencyId).map((rd) => rd.documentId));
    return [...this.documents.values()].filter((d) => {
      if (d.agencyId !== agencyId || attached.has(d.id)) return false;
      if (d.externalSystemId?.startsWith("redacted:") || d.provenance === "prior_release") return false;
      const decided = (d.metadata as { publicationDecision?: unknown } | null)?.publicationDecision != null;
      if (state === "published") return d.classification === "public";
      if (state === "undecided") return d.classification === "internal" && !decided;
      return d.classification === "internal" && decided;
    });
  }
  async countPublicationStates(agencyId: string) {
    return {
      undecided: this.publicationStateDocs(agencyId, "undecided").length,
      published: this.publicationStateDocs(agencyId, "published").length,
      kept_internal: this.publicationStateDocs(agencyId, "kept_internal").length,
    };
  }
  async listPublicationDocuments(
    agencyId: string,
    state: PublicationState,
    opts: { limit: number; before?: { createdAt: Date; id: string } },
  ) {
    return this.publicationStateDocs(agencyId, state)
      .filter(
        (d) =>
          !opts.before ||
          d.createdAt.getTime() < opts.before.createdAt.getTime() ||
          (d.createdAt.getTime() === opts.before.createdAt.getTime() && d.id < opts.before.id),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, opts.limit);
  }
  async setDocumentClassification(agencyId: string, id: string, classification: "public" | "internal") {
    const d = await this.getDocument(agencyId, id);
    if (!d) throw new NotFoundError("Document", id);
    const updated = { ...d, classification };
    this.documents.set(id, updated);
    return updated;
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
