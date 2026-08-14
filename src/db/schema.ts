/**
 * Brandeis — core data model (spec §5).
 *
 * Design invariants baked into this schema:
 *  - Multi-tenant: every domain table carries `agencyId`; row-level enforcement
 *    lives in the data-access layer (see §3, §10). The column is a hard FK.
 *  - The corpus is request-independent: `documents` belongs to the agency, not a
 *    request, and is attached to requests via `requestDocuments` (§5 Document, §9).
 *  - `requestEvents` is append-only — it is the litigation defense (§5, §10).
 *  - AI output never reaches a requester without a named human: release/send
 *    columns carry an approving `userId` (enforced in code per §10).
 *
 * Timestamps: every table has `createdAt`/`updatedAt` via `timestamps`.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

// Embedding dimensionality. Anthropic pipelines embed via a Voyage-class model;
// keep this in one place so a model swap is a single edit + reindex.
export const EMBEDDING_DIMENSIONS = 1024;

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRole = pgEnum("user_role", [
  "admin",
  "coordinator",
  "reviewer",
  "responder",
  "read_only",
]);

export const requesterType = pgEnum("requester_type", [
  "media",
  "legal",
  "commercial",
  "individual",
  "government",
  "anonymous",
]);

export const requestStatus = pgEnum("request_status", [
  "draft",
  "submitted",
  "in_review",
  "clarification_needed",
  "in_progress",
  "records_review",
  "partially_fulfilled",
  "fulfilled",
  "denied",
  // Wrong custodian — the records belong to another agency. Deliberately NOT
  // "denied": denying means we held records and withheld them, and conflating
  // the two corrupts the denial rate an agency reports publicly.
  "referred",
  "withdrawn",
  "closed",
]);

export const jurisdictionType = pgEnum("jurisdiction_type", [
  "city",
  "county",
  "state",
  "federal",
  "school_district",
  "special_district",
  "court",
  "other",
]);

export const visibility = pgEnum("visibility", ["public", "private"]);

export const classification = pgEnum("classification", ["public", "internal"]);

export const taskStatus = pgEnum("task_status", [
  "assigned",
  "in_progress",
  "submitted",
  "pushed_back",
  "done",
  "cancelled",
]);

export const sourceType = pgEnum("source_type", [
  "api_push",
  "webhook",
  "file_drop",
  "scheduled_pull",
  "manual",
]);

export const sourceTrust = pgEnum("source_trust", ["auto_publish", "review_queue"]);

export const syncStatus = pgEnum("sync_status", [
  "never",
  "ok",
  "running",
  "error",
]);

export const documentProvenance = pgEnum("document_provenance", [
  "responder_upload",
  "staff_upload",
  "email_ingest",
  "connector",
  "prior_release",
]);

export const processingStatus = pgEnum("processing_status", [
  "received",
  "scanning",
  "extracting",
  "classifying",
  "embedding",
  "ready",
  "held",
  "failed",
]);

export const reviewDecision = pgEnum("review_decision", [
  "release",
  "release_redacted",
  "withhold",
]);

export const redactionSource = pgEnum("redaction_source", ["ai_suggested", "staff"]);

export const redactionStatus = pgEnum("redaction_status", [
  "suggested",
  "accepted",
  "rejected",
]);

export const messageDirection = pgEnum("message_direction", [
  "inbound",
  "outbound",
  "internal_note",
]);

export const messageChannel = pgEnum("message_channel", ["portal", "email"]);

export const templateKind = pgEnum("template_kind", [
  "acknowledgment",
  "clarification",
  "extension",
  "partial_release",
  "denial",
  "closure",
]);

// Append-only audit event kinds (§5 RequestEvent).
export const eventKind = pgEnum("event_kind", [
  "status_change",
  "message",
  "ai_action",
  "agent_action", // a single step taken by an agent run (§16.2)
  "approval",
  "extension",
  "delivery",
  "assignment",
  "note",
]);

// The five agents of §16.1.
export const agentType = pgEnum("agent_type", [
  "fulfillment",
  "deadline",
  "release_prep",
  "ingest_steward",
  "requester_side",
]);

// Agent run lifecycle (§16.2). Runs are resumable, interruptible, and pause at
// human checkpoints for Tier-3 actions (§16.3).
export const agentRunStatus = pgEnum("agent_run_status", [
  "planning",
  "running",
  "paused", // human-initiated pause/redirect
  "awaiting_checkpoint", // blocked on a required human approval (Tier 3)
  "completed",
  "exhausted", // hit a budget cap; handed off gracefully
  "failed",
  "cancelled",
]);

// ---------------------------------------------------------------------------
// Agency & people
// ---------------------------------------------------------------------------

export const agencies = pgTable("agencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  jurisdiction: text("jurisdiction"), // free-form, e.g. "City of Riverton"
  stateCode: text("state_code").notNull(), // drives statute profile selection (§7)
  branding: jsonb("branding").$type<AgencyBranding>(),
  // Statute configuration is denormalized onto the agency (§7). Seeded from a
  // maintained library of state profiles; profiles are data, not code.
  statuteConfig: jsonb("statute_config").$type<StatuteConfig>(),
  // Observed holidays as ISO date strings ("2026-07-03") for the business-day
  // calendar used by computeDueDate() (§7).
  observedHolidays: jsonb("observed_holidays").$type<string[]>().default([]),
  portalSettings: jsonb("portal_settings").$type<AgencySettings>(),
  // Deterministic keyword→department routing (src/domain/workflow.ts):
  // explicit agency policy, applied at filing with no model in the loop.
  defaultRoutingRules: jsonb("default_routing_rules").$type<
    { departmentId: string; keywords: string[] }[]
  >(),
  // Per-agency workflow automation policy (auto-assignment / auto-dispatch).
  // Opt-in: absent or false means today's fully manual coordinator flow.
  workflowSettings: jsonb("workflow_settings").$type<{
    autoAssign?: boolean;
    autoDispatch?: boolean;
    /** Minimum routing-suggestion confidence (0–1) to dispatch unattended. */
    autoDispatchConfidence?: number;
  }>(),
  ...timestamps,
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    role: userRole("role").notNull().default("coordinator"),
    // scrypt hash ("salt:hex"); null = cannot sign in (e.g. provisioned, no invite accepted).
    passwordHash: text("password_hash"),
    notificationPrefs: jsonb("notification_prefs").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [unique("users_agency_email_unique").on(t.agencyId, t.email)],
);

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    defaultResponderEmails: jsonb("default_responder_emails").$type<string[]>().default([]),
    routingKeywords: jsonb("routing_keywords").$type<string[]>().default([]),
    ...timestamps,
  },
  (t) => [index("departments_agency_idx").on(t.agencyId)],
);

/**
 * Neighboring agencies this tenant refers requests to (city → county, school
 * district, state DOJ…). Most will never be Brandeis tenants, so an entry is
 * plain contact data; `peerAgencyId` links the ones that ARE, which is what
 * makes one-click forwarding possible (phase 3).
 */
export const agencyDirectory = pgTable(
  "agency_directory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The tenant that owns this directory entry.
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    jurisdictionType: jurisdictionType("jurisdiction_type").notNull().default("other"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    portalUrl: text("portal_url"),
    // What this agency holds — drives the phase-2 AI suggestion and staff search.
    recordTypes: jsonb("record_types").$type<string[]>().default([]),
    notes: text("notes"),
    // Set when the referral target is another Brandeis tenant (phase 3).
    peerAgencyId: uuid("peer_agency_id").references(() => agencies.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    index("agency_directory_agency_idx").on(t.agencyId),
    unique("agency_directory_agency_name_unique").on(t.agencyId, t.name),
  ],
);

// Many-to-many: which departments a staff user belongs to.
export const userDepartments = pgTable(
  "user_departments",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.departmentId] })],
);

export const requesters = pgTable(
  "requesters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    name: text("name"),
    email: text("email"), // deduped by email within an agency; null for anonymous
    org: text("org"),
    // scrypt hash; null = no account (anonymous or email-only requester). A
    // requester with prior email-deduped requests "claims" them on registration.
    passwordHash: text("password_hash"),
    // Set once the address is proven. Claimed request history stays hidden
    // until verified (an unverified registrant must not read a stranger's
    // filings just by knowing their email).
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    type: requesterType("type").notNull().default("individual"),
    requestCount: integer("request_count").notNull().default(0),
    vexatiousFlag: boolean("vexatious_flag").notNull().default(false),
    vexatiousReason: text("vexatious_reason"),
    ...timestamps,
  },
  (t) => [unique("requesters_agency_email_unique").on(t.agencyId, t.email)],
);

// ---------------------------------------------------------------------------
// Request — the center of the world (§5)
// ---------------------------------------------------------------------------

export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    // Human-friendly, e.g. "PR-2026-00341". Unique per agency.
    publicId: text("public_id").notNull(),
    requesterId: uuid("requester_id").references(() => requesters.id, {
      onDelete: "set null",
    }),
    status: requestStatus("status").notNull().default("draft"),
    visibility: visibility("visibility").notNull().default("private"),

    // rawText is exactly what the requester wrote — immutable (enforced in code).
    rawText: text("raw_text").notNull(),
    // AI-drafted, staff-editable plain-language restatement (§6.1).
    interpretedScope: text("interpreted_scope"),
    dateRangeStart: timestamp("date_range_start", { withTimezone: true }),
    dateRangeEnd: timestamp("date_range_end", { withTimezone: true }),
    recordTypes: jsonb("record_types").$type<string[]>().default([]),

    // Statutory clock (§7). received_at starts the clock; due dates are computed
    // by computeDueDate() and logged with their basis in requestEvents.
    receivedAt: timestamp("received_at", { withTimezone: true }),
    statutoryDueAt: timestamp("statutory_due_at", { withTimezone: true }),
    extendedDueAt: timestamp("extended_due_at", { withTimezone: true }),
    // Set when the request reaches a terminal outcome (release approved,
    // denied, withdrawn). Drives the §11 on-time and days-to-close metrics.
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // Extension history: [{ at, byUserId, days, reason, statutoryBasis }].
    extensionHistory: jsonb("extension_history")
      .$type<ExtensionRecord[]>()
      .default([]),

    assignedCoordinatorId: uuid("assigned_coordinator_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Referral (wrong custodian). The directory entry we pointed the requester
    // at, plus the moment it happened — the requester-facing tracker shows both.
    referredToDirectoryId: uuid("referred_to_directory_id").references(
      () => agencyDirectory.id,
      { onDelete: "set null" },
    ),
    referredAt: timestamp("referred_at", { withTimezone: true }),
    // Cross-tenant forwarding (referral phase 3). These are DENORMALIZED
    // snapshots (name/slug/publicId copied at forward time), so rendering
    // "forwarded to/from X" never reads the other tenant's rows. Deliberately
    // NOT foreign keys — a cross-tenant FK would let one tenant's delete
    // cascade into another's data.
    forwardedFrom: jsonb("forwarded_from").$type<ForwardLink>(),
    forwardedTo: jsonb("forwarded_to").$type<ForwardLink>(),
    tags: jsonb("tags").$type<string[]>().default([]),

    // Complexity score from intake triage (§6.1), drives internal SLAs.
    complexityScore: real("complexity_score"),
    // Embedding of rawText + interpretedScope for duplicate detection (§6.2).
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),

    ...timestamps,
  },
  (t) => [
    unique("requests_agency_public_id_unique").on(t.agencyId, t.publicId),
    index("requests_agency_status_idx").on(t.agencyId, t.status),
    index("requests_due_idx").on(t.statutoryDueAt),
  ],
);

// Linked requests (duplicates / related) — directed pairs with a relation kind.
export const requestLinks = pgTable(
  "request_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    fromRequestId: uuid("from_request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    toRequestId: uuid("to_request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    relation: text("relation").notNull().default("related"), // "duplicate" | "related"
    ...timestamps,
  },
  (t) => [
    unique("request_links_unique").on(t.fromRequestId, t.toRequestId, t.relation),
  ],
);

/**
 * RequestEvent — append-only audit log (§5, §10). Nothing mutates it.
 * AI actions record model + prompt version + input/output refs for defensibility.
 */
export const requestEvents = pgTable(
  "request_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    kind: eventKind("kind").notNull(),
    // Actor: a staff user, or null for system/AI-initiated events.
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    summary: text("summary").notNull(),
    // Structured payload; for ai_action: { model, promptVersion, inputRef,
    // outputRef, inputTokens, outputTokens }. For status_change: { from, to }.
    // For agent_action: { step, tool/action, disposition, planSnapshot }.
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    // Links an agent-taken step back to its run so "why did it do that" is always
    // answerable, and autonomous sends are attributable in the UI (§16.2, §16.3).
    agentRunId: uuid("agent_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("request_events_request_idx").on(t.requestId, t.createdAt),
    index("request_events_agent_run_idx").on(t.agentRunId),
  ],
);

// ---------------------------------------------------------------------------
// Tasks — sub-requests to departments/responders (§5, §6.3)
// ---------------------------------------------------------------------------

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    assignedResponderEmail: text("assigned_responder_email"),
    scopeText: text("scope_text").notNull(),
    // Internal due date, deliberately ahead of the statutory deadline (§5, §6.3).
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: taskStatus("status").notNull().default("assigned"),
    // Token for no-login access at /task/[token] (§3).
    token: text("token").notNull().unique(),
    // Files a responder attached against the task (name + page count).
    uploads: jsonb("uploads").$type<Array<{ name: string; pages?: number }>>().default([]),
    pushbackNotes: text("pushback_notes"),
    ...timestamps,
  },
  (t) => [index("tasks_request_idx").on(t.requestId)],
);

/**
 * Per-agency, per-year sequence for human-friendly public ids (PR-2026-00341).
 * Atomic increment via upsert, so ids don't collide under concurrency.
 */
export const publicIdCounters = pgTable(
  "public_id_counters",
  {
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    seq: integer("seq").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.agencyId, t.year] })],
);

// ---------------------------------------------------------------------------
// Data plane — Source & the corpus (§5, §9)
// ---------------------------------------------------------------------------

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: sourceType("type").notNull(),
    // Connector kind, e.g. "legistar", "socrata", "procurement_csv", "sharepoint".
    connectorKind: text("connector_kind"),
    // Reference to credentials in the secret store — never the secret itself.
    credentialsRef: text("credentials_ref"),
    syncSchedule: text("sync_schedule"), // cron expression for scheduled_pull
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSyncStatus: syncStatus("last_sync_status").notNull().default("never"),
    lastSyncError: text("last_sync_error"),
    // Incremental-sync cursor / watermark for SourceConnector.discover() (§9.1).
    syncCursor: text("sync_cursor"),
    trust: sourceTrust("trust").notNull().default("review_queue"),
    defaultClassification: classification("default_classification")
      .notNull()
      .default("internal"),
    defaultRecordType: text("default_record_type"),
    defaultDepartmentId: uuid("default_department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    // Per-source payload/field mapping (JSONata-style transform for webhooks, or
    // CSV column mapping template for file drops).
    mappingConfig: jsonb("mapping_config").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [index("sources_agency_idx").on(t.agencyId)],
);

/**
 * Document — the atom of the corpus (§5, §9). NOT owned by a request; belongs to
 * the agency corpus and is attached to requests via requestDocuments.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    provenance: documentProvenance("provenance").notNull(),

    // Storage: original blob + per-page image renders live in object storage;
    // these are opaque references (keys / signed-URL bases), not blobs.
    blobRef: text("blob_ref").notNull(),
    filename: text("filename"),
    mimeType: text("mime_type"),
    byteSize: integer("byte_size"),
    checksum: text("checksum"), // sha-256 of the original blob

    extractedText: text("extracted_text"),
    pageCount: integer("page_count"),
    pageImageRefs: jsonb("page_image_refs").$type<string[]>().default([]),

    processingStatus: processingStatus("processing_status").notNull().default("received"),
    processingError: text("processing_error"),

    // public = answerable/browsable by requesters; internal = staff search only.
    // The answer engine (§6.7) hard-scopes retrieval to classification='public'.
    classification: classification("classification").notNull().default("internal"),
    recordType: text("record_type"),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    // Structured metadata, e.g. { vendor, amount, contractStart } for procurement;
    // { meetingDate, body } for minutes. Powers hybrid search filters (§6.4).
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),

    // Provenance back to the system of record (§5, §6.4 provenance badge).
    externalSystemId: text("external_system_id"),
    externalDeepLink: text("external_deep_link"),

    // Retention schedule + legal hold. Destroying a record that is responsive
    // to an open request is spoliation; a hold is the flag that stops it.
    // retentionUntil is the agency's own schedule date (imported or set);
    // legalHoldReason non-null means "do not destroy", whatever the schedule
    // says. Cleared only by a named human (or automatically when the last
    // open request touching the document closes).
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    legalHoldReason: text("legal_hold_reason"),

    ...timestamps,
  },
  (t) => [
    index("documents_agency_class_idx").on(t.agencyId, t.classification),
    index("documents_agency_record_type_idx").on(t.agencyId, t.recordType),
    // Idempotency on connector re-push (§9.1): re-push updates in place.
    unique("documents_source_external_unique").on(t.sourceId, t.externalSystemId),
  ],
);

// Embedding chunks live in their own table (§5 Document → document_chunks).
export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    // Page span this chunk covers, for citation-with-page-refs (§6.7).
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    ...timestamps,
  },
  (t) => [
    unique("document_chunks_doc_index_unique").on(t.documentId, t.chunkIndex),
    index("document_chunks_document_idx").on(t.documentId),
  ],
);

// Join: which documents are in a request's review set (§5 Document, §9).
export const requestDocuments = pgTable(
  "request_documents",
  {
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    // Why this document matched — the AI-generated one-line rationale (§6.4).
    matchRationale: text("match_rationale"),
    addedByUserId: uuid("added_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.requestId, t.documentId] })],
);

// ---------------------------------------------------------------------------
// Exemptions, review & redaction (§5, §6.5, §7)
// ---------------------------------------------------------------------------

// Catalog entry from the agency's statute config exemption list (§7). Referenced
// by reviews and redactions so an exemption log can be generated per document.
export const exemptionCitations = pgTable(
  "exemption_citations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    statuteSection: text("statute_section").notNull(), // e.g. "Cal. Gov. Code § 7927.705"
    shortLabel: text("short_label").notNull(), // e.g. "Deliberative process"
    description: text("description"),
    ...timestamps,
  },
  (t) => [
    unique("exemption_citations_agency_section_unique").on(t.agencyId, t.statuteSection),
  ],
);

// Per-document release decision (§5 Review).
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    decision: reviewDecision("decision").notNull(),
    // Whole-doc withhold/redaction reason (region-level reasons live on redactions).
    exemptionCitationId: uuid("exemption_citation_id").references(
      () => exemptionCitations.id,
      { onDelete: "set null" },
    ),
    // Free-text exemption short-label until the per-agency citation catalog
    // (§7) is populated; then this becomes a denormalized display copy.
    exemptionLabel: text("exemption_label"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [unique("reviews_request_document_unique").on(t.requestId, t.documentId)],
);

// Per-page redaction region (§5 Redaction, §6.5). Coordinates normalized 0..1.
export const redactions = pgTable(
  "redactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    page: integer("page").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    w: real("w").notNull(),
    h: real("h").notNull(),
    exemptionCitationId: uuid("exemption_citation_id").references(
      () => exemptionCitations.id,
      { onDelete: "set null" },
    ),
    reason: text("reason"),
    source: redactionSource("source").notNull(),
    status: redactionStatus("status").notNull().default("suggested"),
    confidence: real("confidence"), // AI confidence for ai_suggested regions
    rationale: text("rationale"), // one-sentence LLM rationale (§6.5 step 2)
    ...timestamps,
  },
  (t) => [index("redactions_review_idx").on(t.reviewId, t.page)],
);

// ---------------------------------------------------------------------------
// Messaging, releases, templates (§5)
// ---------------------------------------------------------------------------

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    direction: messageDirection("direction").notNull(),
    channel: messageChannel("channel").notNull().default("portal"),
    subject: text("subject"),
    body: text("body").notNull(),
    aiDrafted: boolean("ai_drafted").notNull().default(false),
    // Named human who sent it — required for outbound (enforced in code, §10).
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("messages_request_idx").on(t.requestId, t.createdAt)],
);

/**
 * Release — an immutable delivery (§5). The set of final (redacted) artifacts +
 * response letter sent at a moment in time, with checksums. Powers the archive.
 */
export const releases = pgTable(
  "releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    // Final artifacts: [{ blobRef, filename, checksum, documentId }].
    artifacts: jsonb("artifacts").$type<ReleaseArtifact[]>().notNull().default([]),
    responseLetter: text("response_letter"),
    // Generated exemption log accompanying the release (§6.5).
    exemptionLog: jsonb("exemption_log").$type<Record<string, unknown>>(),
    visibility: visibility("visibility").notNull().default("private"),
    // Named human approver — no release without one (§10, enforced in code).
    approvedByUserId: uuid("approved_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    releasedAt: timestamp("released_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("releases_request_idx").on(t.requestId)],
);

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    kind: templateKind("kind").notNull(),
    name: text("name").notNull(),
    body: text("body").notNull(), // supports merge fields, e.g. {{requester.name}}
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("templates_agency_kind_idx").on(t.agencyId, t.kind)],
);

// ---------------------------------------------------------------------------
// Deflection events (§6.7) — the ROI number agencies show councils.
// ---------------------------------------------------------------------------

/**
 * Durable job queue (spec §4). Jobs persist here so a restart loses NOTHING —
 * the worker loop claims the oldest runnable row (SKIP LOCKED, so a second
 * instance is safe), retries with backoff, and leaves failed rows visible for
 * the operator health surface instead of vanishing into a log. Works on both
 * embedded PGlite and managed Postgres; pg-boss remains a drop-in swap behind
 * the same JobQueue port for multi-instance scale.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    // queued | running | done | failed
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("jobs_status_run_after_idx").on(t.status, t.runAfter)],
);

/**
 * publication_decisions — append-only record of every publish / keep-internal
 * / unpublish call on a corpus document (docs/records-ingestion.md §2).
 * The jsonb `metadata.publicationDecision` on the document is a denormalized
 * cache of the LATEST row here (cheap rendering, same pattern as
 * forwarded_from); THIS table is the tamper-evident history counsel reads.
 * Insert-only; no update/delete paths, ever — same rule as request_events.
 * by_user_id deliberately has no FK: an audit row outlives everything.
 */
export const publicationDecisionKind = pgEnum("publication_decision_kind", [
  "published",
  "kept_internal",
  "unpublished",
]);

export const publicationDecisions = pgTable(
  "publication_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull(), // no FK — history survives the doc
    decision: publicationDecisionKind("decision").notNull(),
    byUserId: uuid("by_user_id").notNull(),
    byName: text("by_name").notNull(),
    /** Mandatory for unpublish; null otherwise. */
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("publication_decisions_agency_doc_idx").on(t.agencyId, t.documentId, t.createdAt)],
);

/**
 * instance_meta — this database's own identity, minted once at first boot.
 * Session JWTs carry the instance id as a claim; guards reject tokens minted
 * against a different database, so a cookie from one deployment (or a
 * reseeded dev database) grants nothing here. Rotating the row is the
 * "sign everyone out" lever.
 */
export const instanceMeta = pgTable("instance_meta", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deflections = pgTable(
  "deflections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    // "download" (satisfied without filing) or "scope_down" (narrowed a request).
    kind: text("kind").notNull(),
    query: text("query"),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    estimatedStaffHoursAvoided: real("estimated_staff_hours_avoided"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deflections_agency_idx").on(t.agencyId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Account administration audit, outbox, and one-time tokens
// ---------------------------------------------------------------------------

/**
 * admin_events — append-only audit for everything OUTSIDE a request's own
 * event log: staff created, roles changed, passwords reset, registrations,
 * agency provisioning. Same defensibility principle as requestEvents (§10),
 * agency-scoped rather than request-scoped. Insert-only; no update/delete.
 */
export const adminEvents = pgTable(
  "admin_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // e.g. "staff_created" | "role_changed" | "password_reset" | ...
    /** Who did it — display string ("Dana Okafor", "platform operator", "self-service"). */
    actorLabel: text("actor_label").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admin_events_agency_idx").on(t.agencyId, t.createdAt)],
);

/**
 * deliveries — the outbox. Every outbound message (task dispatch, reminder,
 * verification, reset, invite) is recorded here by the DbNotifier, whether or
 * not an SMTP adapter actually sent it. In dev this IS the mailbox.
 */
export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    kind: text("kind").notNull(),
    requestId: uuid("request_id").references(() => requests.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    // Relay outcome: null = outbox-only mode (no provider configured, not a
    // failure); "relayed" | "failed" once a provider attempt happened. The
    // operator health surface reads "failed" rows.
    relayStatus: text("relay_status"),
    relayError: text("relay_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deliveries_agency_idx").on(t.agencyId, t.createdAt)],
);

/**
 * auth_tokens — single-use, hashed, expiring tokens for email verification,
 * password resets, and staff invites. Only the sha-256 of the token is stored;
 * the raw value exists exactly once, inside the delivered link.
 */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // "verify_email" | "reset_requester" | "reset_staff" | "staff_invite"
    /** The requester or user this token acts on. */
    subjectId: uuid("subject_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_tokens_subject_idx").on(t.subjectId)],
);

// ---------------------------------------------------------------------------
// Agent runs (§16) — resumable, interruptible, auditable orchestrations
// ---------------------------------------------------------------------------

/**
 * agent_runs — persisted plan state for an agent working over time (§16.2).
 *
 * "Agents are resumable and interruptible: persist plan state in the DB (an
 *  agent_runs table), execute steps as queue jobs, survive restarts, and a human
 *  can pause/redirect any run from the UI."
 *
 * Every step also appends to request_events (kind='agent_action', agentRunId set)
 * so a run is replayable and auditable end-to-end.
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    agentType: agentType("agent_type").notNull(),
    // Per-request agents (fulfillment, release_prep) set this; queue-wide /
    // data-plane agents (deadline, ingest_steward) leave it null (§16.1).
    requestId: uuid("request_id").references(() => requests.id, { onDelete: "cascade" }),
    status: agentRunStatus("status").notNull().default("planning"),
    goal: text("goal").notNull(),
    // The running plan: goal + ordered steps + cursor (§16.1 "a running plan
    // with checkpoints, not a chat log").
    plan: jsonb("plan").$type<AgentPlanState>(),
    // Budget caps and running spend (§16.2 "Budget caps per run").
    budgetLimits: jsonb("budget_limits").$type<AgentBudgetLimits>(),
    budgetSpend: jsonb("budget_spend").$type<AgentBudgetSpend>(),
    // Retrieval scope; requester_side is hard-scoped to the public corpus (§16.3).
    corpusScope: classification("corpus_scope"), // null = full corpus
    // Null actor = system/cron initiated (e.g. the nightly deadline sweep).
    startedByUserId: uuid("started_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    pausedByUserId: uuid("paused_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Graceful "here's where I got to" note on budget exhaustion (§16.2).
    handoffNote: text("handoff_note"),
    lastStepAt: timestamp("last_step_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("agent_runs_agency_status_idx").on(t.agencyId, t.status),
    index("agent_runs_request_idx").on(t.requestId),
  ],
);

/**
 * request_plays — the learning loop's distilled knowledge (docs/
 * learning-loop.md). Each row is one learned cluster of demand ("towing
 * contracts", "bodycam footage") with the statistics of how the office
 * actually resolved it: routes, exemptions, timing, outcomes. Rebuilt
 * NIGHTLY as a full materialized aggregate of the append-only record —
 * never incrementally mutated, so it can't drift from the truth it
 * summarizes. Consulted deterministically at intake; its route confidence
 * feeds the existing auto-dispatch gate (never at 1.0 — explicit rules own
 * that).
 */
export const requestPlays = pgTable(
  "request_plays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    /** Human label built from the cluster's strongest terms. */
    topic: text("topic").notNull(),
    /** Term profile the intake matcher compares new asks against. */
    keywords: jsonb("keywords").$type<string[]>().notNull(),
    stats: jsonb("stats").$type<PlayStats>().notNull(),
    episodeCount: integer("episode_count").notNull(),
    rebuiltAt: timestamp("rebuilt_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("request_plays_agency_idx").on(t.agencyId)],
);

// ---------------------------------------------------------------------------
// Shared JSONB payload types (kept here so schema is the single source of truth)
// ---------------------------------------------------------------------------

/** Aggregated resolution knowledge for one learned demand cluster. */
export interface PlayStats {
  /** Departments that actually produced the records, by share (desc). */
  routes: { departmentId: string | null; department: string; share: number }[];
  /** Exemption labels cited in reviews, by count (desc). */
  exemptions: { label: string; count: number }[];
  /** Terminal statuses → counts (fulfilled, partially_fulfilled, denied, …). */
  outcomes: Record<string, number>;
  medianDaysToClose: number | null;
  /** Share of episodes that took a statutory extension. */
  extensionRate: number;
  /** Precedent request publicIds, newest first (display + prompt context). */
  samplePublicIds: string[];
}

export interface AgentBudgetLimits {
  maxToolCalls: number;
  maxTokens: number;
  maxWallClockMs: number;
}

export interface AgentBudgetSpend {
  toolCalls: number;
  tokens: number;
  wallClockMs: number;
}

/** A single planned step in an agent run (§16.1 running plan). */
export interface AgentPlanStep {
  index: number;
  // Exactly one of tool / action is set: a tool is a read/compute capability;
  // an action is a side-effecting move subject to the tier system (§16.3).
  tool?: string;
  action?: string;
  description: string;
  input?: Record<string, unknown>;
  status: "pending" | "done" | "skipped" | "blocked" | "awaiting_human";
  disposition?: "autonomous" | "requires_human" | "forbidden";
  output?: unknown;
  note?: string;
  /**
   * Named human who approved THIS step at a checkpoint (§16.3 "one approval
   * releases"). A requires_human step executes on resume only when this is
   * set; the approval is scoped to the single step, never the run. Forbidden
   * actions ignore it — nothing approves those.
   */
  approvedByUserId?: string;
}

export interface AgentPlanState {
  goal: string;
  steps: AgentPlanStep[];
  cursor: number; // index of the next step to execute
}

export interface ExtensionRecord {
  at: string; // ISO timestamp
  byUserId: string;
  days: number;
  reason: string;
  statutoryBasis?: string;
}

/**
 * Agency-level settings on the (previously unused) portal_settings column.
 * All optional; absent = the conservative default.
 */
export interface AgencySettings {
  /** Publish the public request log at /[slug]/log (opt-in — default off). */
  publicRequestLog?: boolean;
  /**
   * Counsel sign-off on the statute profile (HANDOFF trust surface): who
   * reviewed the deadline/exemption configuration for THIS agency, and when.
   * Recorded by the agency admin; display-only everywhere else.
   */
  statuteReview?: { reviewedBy: string; reviewedOn: string; note?: string };
  /**
   * Requester status API (agentic-horizon §16.4 first brick, opt-in):
   * GET /api/v1/{slug}/requests/{publicId} serves the tracker's
   * requester-safe projection; webhookUrl (https) receives a ping on every
   * status change / extension. Ping-style on purpose: the POST carries only
   * tracking-number-level facts, and subscribers verify against the status
   * API — so there is no signing secret to store.
   */
  statusApi?: { enabled: boolean; webhookUrl?: string | null };
  /**
   * Requester API + MCP server (docs/requester-api.md, opt-in): the machine
   * door onto the portal's PUBLIC surface — archive search, record reads,
   * status by tracking number, and (separately gated) filing. Everything it
   * serves is a projection of what the portal already shows anyone; enabling
   * it never widens what a requester can see (invariant 3 unmoved).
   */
  requesterApi?: { enabled: boolean; filingEnabled?: boolean };
}

/**
 * Per-tenant identity (portal branding). Everything optional — the portal
 * falls back to the generic civic seal and sensible defaults, so a fresh
 * tenant looks respectable before its clerk uploads anything.
 */
export interface AgencyBranding {
  /** e.g. "Office of the City Clerk" (the default), "Records Division". */
  officeName?: string;
  contactEmail?: string;
  addressLines?: string[];
  hours?: string;
  /** Hex accent replacing the portal navy — contrast-guarded on write. */
  accentColor?: string;
  /** Blob key of the uploaded seal image (PNG/JPEG, scanned at upload). */
  sealBlobRef?: string;
}

/**
 * One side of a cross-tenant forward (referral phase 3). Everything needed to
 * DISPLAY the link is denormalized here so no read ever crosses tenants; the
 * ids exist for audit, not for joins.
 */
export interface ForwardLink {
  agencyId: string;
  agencySlug: string;
  agencyName: string;
  requestId: string;
  publicId: string;
  at: string; // ISO timestamp
}

export interface ReleaseArtifact {
  blobRef: string;
  filename: string;
  checksum: string;
  documentId?: string;
}

/**
 * StatuteConfig — the per-agency statute profile (§7). Seeded from state
 * profiles; this is the shape the statute engine consumes. Deadline computation
 * is implemented in ../statute/computeDueDate.ts against this type.
 */
export interface StatuteConfig {
  stateCode: string;
  stateName: string;
  responseClock: {
    initialDays: number;
    dayType: "calendar" | "business";
    // What starts the clock; informational + used by intake to set received_at.
    clockStartsOn: "receipt" | "next_business_day";
    extension: {
      allowed: boolean;
      maxDays: number;
      dayType: "calendar" | "business";
      permittedReasons: string[];
      noticeRequired: boolean;
    };
  };
  exemptions: Array<{
    statuteSection: string;
    shortLabel: string;
    description?: string;
  }>;
  appeal: {
    process?: string;
    language?: string;
    deadlineDays?: number;
  };
  specialRegimes?: string[]; // e.g. ["body_cam_timeline", "arrestee_data"]
}

// Re-export a convenience list of all tables (useful for tenant-isolation tests).
export const allTables = {
  agencies,
  users,
  departments,
  userDepartments,
  requesters,
  requests,
  requestLinks,
  requestEvents,
  tasks,
  sources,
  documents,
  documentChunks,
  requestDocuments,
  exemptionCitations,
  reviews,
  redactions,
  messages,
  releases,
  templates,
  deflections,
  adminEvents,
  deliveries,
  authTokens,
  agentRuns,
  publicIdCounters,
  requestPlays,
  jobs,
  publicationDecisions,
  instanceMeta,
} as const;

// Silence unused-import warning for `sql` when no raw defaults are used yet; it
// is kept imported for forthcoming generated columns / raw defaults.
void sql;
