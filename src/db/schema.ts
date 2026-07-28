/**
 * Clerk — core data model (spec §5).
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
  numeric,
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
  "fee_pending",
  "partially_fulfilled",
  "fulfilled",
  "denied",
  "withdrawn",
  "closed",
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

export const feeStatus = pgEnum("fee_status", [
  "draft",
  "sent",
  "paid",
  "waived",
  "cancelled",
]);

export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "succeeded",
  "failed",
  "refunded",
  "recorded_manually",
]);

export const templateKind = pgEnum("template_kind", [
  "acknowledgment",
  "clarification",
  "extension",
  "fee_estimate",
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
  branding: jsonb("branding").$type<{
    logoUrl?: string;
    primaryColor?: string;
    accentColor?: string;
  }>(),
  // Statute configuration is denormalized onto the agency (§7). Seeded from a
  // maintained library of state profiles; profiles are data, not code.
  statuteConfig: jsonb("statute_config").$type<StatuteConfig>(),
  // Observed holidays as ISO date strings ("2026-07-03") for the business-day
  // calendar used by computeDueDate() (§7).
  observedHolidays: jsonb("observed_holidays").$type<string[]>().default([]),
  feeSchedule: jsonb("fee_schedule").$type<Record<string, unknown>>(),
  portalSettings: jsonb("portal_settings").$type<Record<string, unknown>>(),
  defaultRoutingRules: jsonb("default_routing_rules").$type<Record<string, unknown>>(),
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
    // Extension history: [{ at, byUserId, days, reason, statutoryBasis }].
    extensionHistory: jsonb("extension_history")
      .$type<ExtensionRecord[]>()
      .default([]),

    assignedCoordinatorId: uuid("assigned_coordinator_id").references(() => users.id, {
      onDelete: "set null",
    }),
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
    pushbackNotes: text("pushback_notes"),
    ...timestamps,
  },
  (t) => [index("tasks_request_idx").on(t.requestId)],
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
// Messaging, fees, releases, templates (§5)
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

export const feeEstimates = pgTable(
  "fee_estimates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    // Line items: [{ label, kind: "staff_time"|"copies"|"media", qty, rate, amount }].
    lineItems: jsonb("line_items").$type<FeeLineItem[]>().default([]),
    total: numeric("total", { precision: 12, scale: 2 }),
    status: feeStatus("status").notNull().default("draft"),
    waiverReason: text("waiver_reason"),
    ...timestamps,
  },
  (t) => [index("fee_estimates_request_idx").on(t.requestId)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    feeEstimateId: uuid("fee_estimate_id").references(() => feeEstimates.id, {
      onDelete: "set null",
    }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    provider: text("provider"), // "stripe" | "manual"
    providerRef: text("provider_ref"),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [index("payments_request_idx").on(t.requestId)],
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

// ---------------------------------------------------------------------------
// Shared JSONB payload types (kept here so schema is the single source of truth)
// ---------------------------------------------------------------------------

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

export interface FeeLineItem {
  label: string;
  kind: "staff_time" | "copies" | "media" | "other";
  qty: number;
  rate: number;
  amount: number;
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
  feeRules: {
    chargeableItems: string[];
    staffTimeRatePerHour?: number;
    copyRatePerPage?: number;
    waiverStandard?: string;
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
  feeEstimates,
  payments,
  releases,
  templates,
  deflections,
  agentRuns,
} as const;

// Silence unused-import warning for `sql` when no raw defaults are used yet; it
// is kept imported for forthcoming generated columns / raw defaults.
void sql;
