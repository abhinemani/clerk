/**
 * Drizzle-backed Repository (spec §3/§10) — the one adapter that runs on BOTH
 * embedded PGlite and a managed Postgres, because both speak the same pg dialect
 * and share this schema. Business logic (services) depends only on the port, so
 * nothing above this file changes when the backend does.
 *
 * Tenant isolation is enforced in every read: queries AND `agency_id` in, and a
 * row from another agency is invisible.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import {
  adminEvents,
  agencies,
  agencyDirectory,
  authTokens,
  deflections,
  deliveries,
  departments,
  documentChunks,
  documents,
  messages,
  publicIdCounters,
  releases,
  requestDocuments,
  requestEvents,
  requesters,
  requests,
  reviews,
  sources,
  tasks,
  users,
} from "@/db/schema";
import { tenantWhere } from "@/db/tenant";
import {
  NotFoundError,
  type AdminEventEntity,
  type Agency,
  type AuthTokenEntity,
  type DeflectionEntity,
  type DeliveryEntity,
  type Department,
  type DirectoryEntry,
  type DocumentEntity,
  type EventEntity,
  type MessageEntity,
  type ReleaseEntity,
  type RequestEntity,
  type Requester,
  type Repository,
  type ReviewEntity,
  type SourceEntity,
  type TaskEntity,
  type UserEntity,
} from "@/services/repository";

// A Drizzle instance from either the postgres-js or pglite driver.
type Db = PgDatabase<any, any, any>;

export class DrizzleRepository implements Repository {
  constructor(private readonly db: Db) {}

  async getAgency(agencyId: string): Promise<Agency | null> {
    const [a] = await this.db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1);
    return a ? this.toAgency(a) : null;
  }
  async getAgencyBySlug(slug: string): Promise<Agency | null> {
    const [a] = await this.db.select().from(agencies).where(eq(agencies.slug, slug)).limit(1);
    return a ? this.toAgency(a) : null;
  }
  async listAgencies(): Promise<Agency[]> {
    const rows = await this.db.select().from(agencies);
    return rows.map((a: typeof agencies.$inferSelect) => this.toAgency(a));
  }
  async createAgency(a: Agency): Promise<Agency> {
    await this.db.insert(agencies).values({
      id: a.id,
      slug: a.slug,
      name: a.name,
      stateCode: a.stateCode,
      observedHolidays: a.observedHolidays,
      workflowSettings: a.workflowSettings ?? null,
    });
    return a;
  }
  async updateAgency(
    agencyId: string,
    patch: Partial<Pick<Agency, "workflowSettings" | "defaultRoutingRules">>,
  ): Promise<Agency> {
    const set: Record<string, unknown> = {};
    if ("workflowSettings" in patch) set.workflowSettings = patch.workflowSettings ?? null;
    if ("defaultRoutingRules" in patch) set.defaultRoutingRules = patch.defaultRoutingRules ?? null;
    if (Object.keys(set).length > 0) {
      await this.db.update(agencies).set(set).where(eq(agencies.id, agencyId));
    }
    const updated = await this.getAgency(agencyId);
    if (!updated) throw new NotFoundError("Agency", agencyId);
    return updated;
  }
  private toAgency(a: typeof agencies.$inferSelect): Agency {
    return {
      id: a.id,
      slug: a.slug,
      name: a.name,
      stateCode: a.stateCode,
      observedHolidays: a.observedHolidays ?? [],
      workflowSettings: a.workflowSettings ?? null,
      defaultRoutingRules: (a.defaultRoutingRules as Agency["defaultRoutingRules"]) ?? null,
    };
  }

  async findRequesterByEmail(agencyId: string, email: string): Promise<Requester | null> {
    const [r] = await this.db
      .select()
      .from(requesters)
      .where(tenantWhere(requesters.agencyId, agencyId, eq(requesters.email, email)))
      .limit(1);
    return r ? this.toRequester(r) : null;
  }
  async getRequester(agencyId: string, id: string): Promise<Requester | null> {
    const [r] = await this.db
      .select()
      .from(requesters)
      .where(tenantWhere(requesters.agencyId, agencyId, eq(requesters.id, id)))
      .limit(1);
    return r ? this.toRequester(r) : null;
  }
  async listRequesters(agencyId: string): Promise<Requester[]> {
    const rows = await this.db.select().from(requesters).where(eq(requesters.agencyId, agencyId));
    return rows.map((r: typeof requesters.$inferSelect) => this.toRequester(r));
  }
  async createRequester(r: Requester): Promise<Requester> {
    await this.db.insert(requesters).values({
      id: r.id,
      agencyId: r.agencyId,
      email: r.email,
      name: r.name,
      type: r.type,
      passwordHash: r.passwordHash ?? null,
      emailVerifiedAt: r.emailVerifiedAt ?? null,
    });
    return r;
  }
  async updateRequester(agencyId: string, id: string, patch: Partial<Requester>): Promise<Requester> {
    const set: Record<string, unknown> = {};
    for (const k of ["name", "email", "type", "passwordHash", "emailVerifiedAt"] as const) {
      if (k in patch) set[k] = patch[k];
    }
    const rows = await this.db
      .update(requesters)
      .set(set)
      .where(tenantWhere(requesters.agencyId, agencyId, eq(requesters.id, id)))
      .returning();
    if (!rows[0]) throw new NotFoundError("Requester", id);
    return this.toRequester(rows[0]);
  }
  private toRequester(r: typeof requesters.$inferSelect): Requester {
    return {
      id: r.id,
      agencyId: r.agencyId,
      email: r.email,
      name: r.name,
      type: r.type,
      passwordHash: r.passwordHash,
      emailVerifiedAt: r.emailVerifiedAt,
    };
  }

  async findUserByEmail(agencyId: string, email: string): Promise<UserEntity | null> {
    const [u] = await this.db
      .select()
      .from(users)
      .where(tenantWhere(users.agencyId, agencyId, eq(users.email, email)))
      .limit(1);
    return u ? this.toUser(u) : null;
  }
  async getUser(agencyId: string, id: string): Promise<UserEntity | null> {
    const [u] = await this.db
      .select()
      .from(users)
      .where(tenantWhere(users.agencyId, agencyId, eq(users.id, id)))
      .limit(1);
    return u ? this.toUser(u) : null;
  }
  async listUsers(agencyId: string): Promise<UserEntity[]> {
    const rows = await this.db.select().from(users).where(eq(users.agencyId, agencyId));
    return rows.map((u: typeof users.$inferSelect) => this.toUser(u));
  }
  async createUser(u: UserEntity): Promise<UserEntity> {
    await this.db.insert(users).values({
      id: u.id,
      agencyId: u.agencyId,
      email: u.email,
      name: u.name,
      role: u.role,
      passwordHash: u.passwordHash,
    });
    return u;
  }
  async updateUser(agencyId: string, id: string, patch: Partial<UserEntity>): Promise<UserEntity> {
    const set: Record<string, unknown> = {};
    for (const k of ["name", "email", "role", "passwordHash"] as const) {
      if (k in patch) set[k] = patch[k];
    }
    const rows = await this.db
      .update(users)
      .set(set)
      .where(tenantWhere(users.agencyId, agencyId, eq(users.id, id)))
      .returning();
    if (!rows[0]) throw new NotFoundError("User", id);
    return this.toUser(rows[0]);
  }
  private toUser(u: typeof users.$inferSelect): UserEntity {
    return { id: u.id, agencyId: u.agencyId, email: u.email, name: u.name, role: u.role, passwordHash: u.passwordHash };
  }

  async listRequestsByRequester(agencyId: string, requesterId: string): Promise<RequestEntity[]> {
    const rows = await this.db
      .select()
      .from(requests)
      .where(tenantWhere(requests.agencyId, agencyId, eq(requests.requesterId, requesterId)))
      .orderBy(desc(requests.createdAt));
    return rows.map((r: typeof requests.$inferSelect) => this.toRequest(r));
  }

  async listDepartments(agencyId: string): Promise<Department[]> {
    const rows = await this.db.select().from(departments).where(eq(departments.agencyId, agencyId));
    return rows.map((d: typeof departments.$inferSelect) => ({
      id: d.id,
      agencyId: d.agencyId,
      name: d.name,
      defaultResponderEmails: d.defaultResponderEmails ?? [],
    }));
  }

  async nextPublicIdSeq(agencyId: string, year: number): Promise<number> {
    const [row] = await this.db
      .insert(publicIdCounters)
      .values({ agencyId, year, seq: 1 })
      .onConflictDoUpdate({
        target: [publicIdCounters.agencyId, publicIdCounters.year],
        set: { seq: sql`${publicIdCounters.seq} + 1` },
      })
      .returning({ seq: publicIdCounters.seq });
    return row!.seq;
  }

  async createRequest(r: RequestEntity): Promise<RequestEntity> {
    await this.db.insert(requests).values({
      id: r.id,
      agencyId: r.agencyId,
      publicId: r.publicId,
      requesterId: r.requesterId,
      status: r.status,
      rawText: r.rawText,
      interpretedScope: r.interpretedScope,
      recordTypes: r.recordTypes,
      complexityScore: r.complexityScore,
      receivedAt: r.receivedAt,
      statutoryDueAt: r.statutoryDueAt,
      assignedCoordinatorId: r.assignedCoordinatorId ?? null,
      closedAt: r.closedAt,
      createdAt: r.createdAt,
    });
    return r;
  }
  async getRequest(agencyId: string, id: string): Promise<RequestEntity | null> {
    const [r] = await this.db
      .select()
      .from(requests)
      .where(tenantWhere(requests.agencyId, agencyId, eq(requests.id, id)))
      .limit(1);
    return r ? this.toRequest(r) : null;
  }
  async findRequestByPublicId(agencyId: string, publicId: string): Promise<RequestEntity | null> {
    const [r] = await this.db
      .select()
      .from(requests)
      .where(tenantWhere(requests.agencyId, agencyId, eq(requests.publicId, publicId)))
      .limit(1);
    return r ? this.toRequest(r) : null;
  }
  async listRequests(agencyId: string): Promise<RequestEntity[]> {
    const rows = await this.db
      .select()
      .from(requests)
      .where(eq(requests.agencyId, agencyId))
      .orderBy(desc(requests.createdAt));
    return rows.map((r: typeof requests.$inferSelect) => this.toRequest(r));
  }
  async updateRequest(agencyId: string, id: string, patch: Partial<RequestEntity>): Promise<RequestEntity> {
    const set: Record<string, unknown> = {};
    for (const k of ["status", "interpretedScope", "recordTypes", "complexityScore", "statutoryDueAt", "receivedAt", "closedAt", "extensionHistory", "assignedCoordinatorId", "referredToDirectoryId", "referredAt", "forwardedFrom", "forwardedTo"] as const) {
      if (k in patch) set[k] = patch[k];
    }
    const rows = await this.db
      .update(requests)
      .set(set)
      .where(tenantWhere(requests.agencyId, agencyId, eq(requests.id, id)))
      .returning();
    if (!rows[0]) throw new NotFoundError("Request", id);
    return this.toRequest(rows[0]);
  }
  private toRequest(r: typeof requests.$inferSelect): RequestEntity {
    return {
      id: r.id,
      agencyId: r.agencyId,
      publicId: r.publicId,
      requesterId: r.requesterId,
      status: r.status,
      rawText: r.rawText,
      interpretedScope: r.interpretedScope,
      recordTypes: r.recordTypes ?? [],
      complexityScore: r.complexityScore,
      receivedAt: r.receivedAt,
      statutoryDueAt: r.statutoryDueAt,
      extensionHistory: r.extensionHistory ?? [],
      assignedCoordinatorId: r.assignedCoordinatorId ?? null,
      referredToDirectoryId: r.referredToDirectoryId ?? null,
      referredAt: r.referredAt ?? null,
      forwardedFrom: r.forwardedFrom ?? null,
      forwardedTo: r.forwardedTo ?? null,
      closedAt: r.closedAt,
      createdAt: r.createdAt,
    };
  }

  async listDirectory(agencyId: string): Promise<DirectoryEntry[]> {
    const rows = await this.db
      .select()
      .from(agencyDirectory)
      .where(eq(agencyDirectory.agencyId, agencyId))
      .orderBy(agencyDirectory.name);
    return rows.map((d: typeof agencyDirectory.$inferSelect) => this.toDirectoryEntry(d));
  }
  async getDirectoryEntry(agencyId: string, id: string): Promise<DirectoryEntry | null> {
    const [d] = await this.db
      .select()
      .from(agencyDirectory)
      .where(tenantWhere(agencyDirectory.agencyId, agencyId, eq(agencyDirectory.id, id)))
      .limit(1);
    return d ? this.toDirectoryEntry(d) : null;
  }
  async createDirectoryEntry(e: DirectoryEntry): Promise<DirectoryEntry> {
    await this.db.insert(agencyDirectory).values({
      id: e.id,
      agencyId: e.agencyId,
      name: e.name,
      jurisdictionType: e.jurisdictionType,
      contactEmail: e.contactEmail,
      contactPhone: e.contactPhone,
      portalUrl: e.portalUrl,
      recordTypes: e.recordTypes,
      notes: e.notes,
      peerAgencyId: e.peerAgencyId,
    });
    return e;
  }
  async updateDirectoryEntry(
    agencyId: string,
    id: string,
    patch: Partial<Omit<DirectoryEntry, "id" | "agencyId">>,
  ): Promise<DirectoryEntry> {
    const set: Record<string, unknown> = {};
    for (const k of [
      "name", "jurisdictionType", "contactEmail", "contactPhone",
      "portalUrl", "recordTypes", "notes", "peerAgencyId",
    ] as const) {
      if (k in patch) set[k] = patch[k];
    }
    const rows = await this.db
      .update(agencyDirectory)
      .set(set)
      .where(tenantWhere(agencyDirectory.agencyId, agencyId, eq(agencyDirectory.id, id)))
      .returning();
    if (!rows[0]) throw new NotFoundError("DirectoryEntry", id);
    return this.toDirectoryEntry(rows[0]);
  }
  async deleteDirectoryEntry(agencyId: string, id: string): Promise<void> {
    await this.db
      .delete(agencyDirectory)
      .where(tenantWhere(agencyDirectory.agencyId, agencyId, eq(agencyDirectory.id, id)));
  }
  private toDirectoryEntry(d: typeof agencyDirectory.$inferSelect): DirectoryEntry {
    return {
      id: d.id,
      agencyId: d.agencyId,
      name: d.name,
      jurisdictionType: d.jurisdictionType,
      contactEmail: d.contactEmail,
      contactPhone: d.contactPhone,
      portalUrl: d.portalUrl,
      recordTypes: d.recordTypes ?? [],
      notes: d.notes,
      peerAgencyId: d.peerAgencyId,
    };
  }

  async createTask(t: TaskEntity): Promise<TaskEntity> {
    await this.db.insert(tasks).values({
      id: t.id,
      agencyId: t.agencyId,
      requestId: t.requestId,
      departmentId: t.departmentId,
      scopeText: t.scopeText,
      status: t.status,
      token: t.token,
      dueAt: t.dueAt,
      uploads: t.uploads,
      pushbackNotes: t.pushbackNotes,
    });
    return t;
  }
  async getTask(agencyId: string, id: string): Promise<TaskEntity | null> {
    const [t] = await this.db.select().from(tasks).where(tenantWhere(tasks.agencyId, agencyId, eq(tasks.id, id))).limit(1);
    return t ? this.toTask(t) : null;
  }
  async getRequestByIngestId(requestId: string): Promise<RequestEntity | null> {
    const [r] = await this.db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
    return r ? this.toRequest(r) : null;
  }
  async getTaskByToken(token: string): Promise<TaskEntity | null> {
    const [t] = await this.db.select().from(tasks).where(eq(tasks.token, token)).limit(1);
    return t ? this.toTask(t) : null;
  }
  async listTasks(agencyId: string, requestId: string): Promise<TaskEntity[]> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(tenantWhere(tasks.agencyId, agencyId, eq(tasks.requestId, requestId)));
    return rows.map((r: typeof tasks.$inferSelect) => this.toTask(r));
  }
  async listAgencyTasks(agencyId: string): Promise<TaskEntity[]> {
    const rows = await this.db.select().from(tasks).where(eq(tasks.agencyId, agencyId));
    return rows.map((r: typeof tasks.$inferSelect) => this.toTask(r));
  }
  async updateTask(agencyId: string, id: string, patch: Partial<TaskEntity>): Promise<TaskEntity> {
    const set: Record<string, unknown> = {};
    for (const k of ["status", "uploads", "pushbackNotes", "dueAt", "departmentId"] as const) {
      if (k in patch) set[k] = patch[k];
    }
    const rows = await this.db
      .update(tasks)
      .set(set)
      .where(tenantWhere(tasks.agencyId, agencyId, eq(tasks.id, id)))
      .returning();
    if (!rows[0]) throw new NotFoundError("Task", id);
    return this.toTask(rows[0]);
  }
  private toTask(t: typeof tasks.$inferSelect): TaskEntity {
    return {
      id: t.id,
      agencyId: t.agencyId,
      requestId: t.requestId,
      departmentId: t.departmentId,
      scopeText: t.scopeText,
      status: t.status,
      token: t.token,
      dueAt: t.dueAt,
      uploads: t.uploads ?? [],
      pushbackNotes: t.pushbackNotes,
    };
  }

  async appendEvent(e: EventEntity): Promise<EventEntity> {
    await this.db.insert(requestEvents).values({
      id: e.id,
      agencyId: e.agencyId,
      requestId: e.requestId,
      kind: e.kind,
      actorUserId: e.actorUserId,
      summary: e.summary,
      payload: e.payload,
      createdAt: e.createdAt,
    });
    return e;
  }
  async listEvents(agencyId: string, requestId: string): Promise<EventEntity[]> {
    const rows = await this.db
      .select()
      .from(requestEvents)
      .where(tenantWhere(requestEvents.agencyId, agencyId, eq(requestEvents.requestId, requestId)));
    return rows
      .map((r: typeof requestEvents.$inferSelect) => ({
        id: r.id,
        agencyId: r.agencyId,
        requestId: r.requestId,
        kind: r.kind,
        actorUserId: r.actorUserId,
        summary: r.summary,
        payload: r.payload ?? undefined,
        createdAt: r.createdAt,
      }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async createMessage(m: MessageEntity): Promise<MessageEntity> {
    await this.db.insert(messages).values({
      id: m.id,
      agencyId: m.agencyId,
      requestId: m.requestId,
      direction: m.direction,
      channel: m.channel,
      subject: m.subject,
      body: m.body,
      aiDrafted: m.aiDrafted,
      sentByUserId: m.sentByUserId,
      sentAt: m.sentAt,
      createdAt: m.createdAt,
    });
    return m;
  }
  async listMessages(agencyId: string, requestId: string): Promise<MessageEntity[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(tenantWhere(messages.agencyId, agencyId, eq(messages.requestId, requestId)));
    return rows
      .map((m: typeof messages.$inferSelect) => ({
        id: m.id,
        agencyId: m.agencyId,
        requestId: m.requestId,
        direction: m.direction,
        channel: m.channel,
        subject: m.subject,
        body: m.body,
        aiDrafted: m.aiDrafted,
        sentByUserId: m.sentByUserId,
        sentAt: m.sentAt ?? m.createdAt,
        createdAt: m.createdAt,
      }))
      .sort((a: MessageEntity, b: MessageEntity) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async upsertDocumentByExternalId(doc: DocumentEntity): Promise<{ document: DocumentEntity; created: boolean }> {
    const existing = doc.externalSystemId
      ? (
          await this.db
            .select()
            .from(documents)
            .where(
              and(
                eq(documents.agencyId, doc.agencyId),
                doc.sourceId ? eq(documents.sourceId, doc.sourceId) : sql`${documents.sourceId} is null`,
                eq(documents.externalSystemId, doc.externalSystemId),
              ),
            )
            .limit(1)
        )[0]
      : undefined;

    if (existing) {
      const rows = await this.db
        .update(documents)
        .set({
          filename: doc.filename,
          classification: doc.classification,
          recordType: doc.recordType,
          processingStatus: doc.processingStatus as never,
          metadata: doc.metadata,
        })
        .where(eq(documents.id, existing.id))
        .returning();
      return { document: this.toDocument(rows[0]!), created: false };
    }

    await this.db.insert(documents).values({
      id: doc.id,
      agencyId: doc.agencyId,
      sourceId: doc.sourceId,
      provenance: "connector",
      blobRef: doc.filename ?? doc.externalSystemId ?? doc.id,
      externalSystemId: doc.externalSystemId,
      filename: doc.filename,
      classification: doc.classification,
      recordType: doc.recordType,
      processingStatus: doc.processingStatus as never,
      metadata: doc.metadata,
      createdAt: doc.createdAt,
    });
    return { document: doc, created: true };
  }
  private toDocument(d: typeof documents.$inferSelect): DocumentEntity {
    return {
      id: d.id,
      agencyId: d.agencyId,
      sourceId: d.sourceId,
      externalSystemId: d.externalSystemId,
      filename: d.filename,
      classification: d.classification,
      recordType: d.recordType,
      processingStatus: d.processingStatus,
      metadata: d.metadata,
      blobRef: d.blobRef,
      byteSize: d.byteSize,
      mimeType: d.mimeType,
      checksum: d.checksum,
      extractedText: d.extractedText,
      pageCount: d.pageCount,
      retentionUntil: d.retentionUntil,
      legalHoldReason: d.legalHoldReason,
      createdAt: d.createdAt,
    };
  }

  async listPublicDocuments(agencyId: string): Promise<DocumentEntity[]> {
    const rows = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.agencyId, agencyId), eq(documents.classification, "public")))
      .orderBy(desc(documents.createdAt));
    return rows.map((d: typeof documents.$inferSelect) => this.toDocument(d));
  }

  async listDocuments(agencyId: string): Promise<DocumentEntity[]> {
    const rows = await this.db
      .select()
      .from(documents)
      .where(eq(documents.agencyId, agencyId))
      .orderBy(desc(documents.createdAt));
    return rows.map((d: typeof documents.$inferSelect) => this.toDocument(d));
  }

  async appendAdminEvent(e: AdminEventEntity): Promise<AdminEventEntity> {
    await this.db.insert(adminEvents).values({
      id: e.id,
      agencyId: e.agencyId,
      kind: e.kind,
      actorLabel: e.actorLabel,
      summary: e.summary,
      payload: e.payload,
      createdAt: e.createdAt,
    });
    return e;
  }
  async listAdminEvents(agencyId: string, limit = 50): Promise<AdminEventEntity[]> {
    const rows = await this.db
      .select()
      .from(adminEvents)
      .where(eq(adminEvents.agencyId, agencyId))
      .orderBy(desc(adminEvents.createdAt))
      .limit(limit);
    return rows.map((e: typeof adminEvents.$inferSelect) => ({
      id: e.id,
      agencyId: e.agencyId,
      kind: e.kind,
      actorLabel: e.actorLabel,
      summary: e.summary,
      payload: e.payload ?? undefined,
      createdAt: e.createdAt,
    }));
  }

  async createDelivery(d: DeliveryEntity): Promise<DeliveryEntity> {
    await this.db.insert(deliveries).values({
      id: d.id,
      agencyId: d.agencyId,
      toEmail: d.toEmail,
      subject: d.subject,
      body: d.body,
      kind: d.kind,
      requestId: d.requestId,
      taskId: d.taskId,
      createdAt: d.createdAt,
    });
    return d;
  }
  async listDeliveries(agencyId: string, limit = 50): Promise<DeliveryEntity[]> {
    const rows = await this.db
      .select()
      .from(deliveries)
      .where(eq(deliveries.agencyId, agencyId))
      .orderBy(desc(deliveries.createdAt))
      .limit(limit);
    return rows.map((d: typeof deliveries.$inferSelect) => ({
      id: d.id,
      agencyId: d.agencyId,
      toEmail: d.toEmail,
      subject: d.subject,
      body: d.body,
      kind: d.kind,
      requestId: d.requestId,
      taskId: d.taskId,
      createdAt: d.createdAt,
    }));
  }

  async createAuthToken(t: AuthTokenEntity): Promise<AuthTokenEntity> {
    await this.db.insert(authTokens).values({
      id: t.id,
      agencyId: t.agencyId,
      kind: t.kind,
      subjectId: t.subjectId,
      tokenHash: t.tokenHash,
      expiresAt: t.expiresAt,
      usedAt: t.usedAt,
      createdAt: t.createdAt,
    });
    return t;
  }
  async findAuthTokenByHash(tokenHash: string): Promise<AuthTokenEntity | null> {
    const [t] = await this.db.select().from(authTokens).where(eq(authTokens.tokenHash, tokenHash)).limit(1);
    return t
      ? {
          id: t.id,
          agencyId: t.agencyId,
          kind: t.kind as AuthTokenEntity["kind"],
          subjectId: t.subjectId,
          tokenHash: t.tokenHash,
          expiresAt: t.expiresAt,
          usedAt: t.usedAt,
          createdAt: t.createdAt,
        }
      : null;
  }
  async markAuthTokenUsed(id: string, usedAt: Date): Promise<void> {
    await this.db.update(authTokens).set({ usedAt }).where(eq(authTokens.id, id));
  }

  async createSource(s: SourceEntity): Promise<SourceEntity> {
    await this.db.insert(sources).values({
      id: s.id,
      agencyId: s.agencyId,
      name: s.name,
      type: s.type,
      credentialsRef: s.apiKeyHash ? `sha256:${s.apiKeyHash}` : null,
      trust: s.trust,
      defaultClassification: s.defaultClassification,
    });
    return s;
  }
  async findSourceByApiKeyHash(agencyId: string, apiKeyHash: string): Promise<SourceEntity | null> {
    const [s] = await this.db
      .select()
      .from(sources)
      .where(tenantWhere(sources.agencyId, agencyId, eq(sources.credentialsRef, `sha256:${apiKeyHash}`)))
      .limit(1);
    if (!s) return null;
    return {
      id: s.id,
      agencyId: s.agencyId,
      name: s.name,
      type: s.type,
      apiKeyHash,
      trust: s.trust,
      defaultClassification: s.defaultClassification,
    };
  }

  async createDocument(doc: DocumentEntity): Promise<DocumentEntity> {
    await this.db.insert(documents).values({
      id: doc.id,
      agencyId: doc.agencyId,
      sourceId: doc.sourceId,
      provenance: doc.provenance ?? "responder_upload",
      blobRef: doc.blobRef ?? doc.filename ?? doc.id,
      byteSize: doc.byteSize,
      mimeType: doc.mimeType,
      checksum: doc.checksum,
      extractedText: doc.extractedText,
      pageCount: doc.pageCount,
      externalSystemId: doc.externalSystemId,
      filename: doc.filename,
      classification: doc.classification,
      recordType: doc.recordType,
      processingStatus: doc.processingStatus as never,
      metadata: doc.metadata,
      createdAt: doc.createdAt,
    });
    return doc;
  }
  async getDocument(agencyId: string, id: string): Promise<DocumentEntity | null> {
    const [d] = await this.db
      .select()
      .from(documents)
      .where(tenantWhere(documents.agencyId, agencyId, eq(documents.id, id)))
      .limit(1);
    return d ? this.toDocument(d) : null;
  }
  async updateDocument(
    agencyId: string,
    id: string,
    patch: Partial<
      Pick<
        DocumentEntity,
        "metadata" | "processingStatus" | "extractedText" | "pageCount" | "retentionUntil" | "legalHoldReason"
      >
    >,
  ): Promise<DocumentEntity> {
    const rows = await this.db
      .update(documents)
      .set({
        ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
        ...(patch.processingStatus !== undefined
          ? { processingStatus: patch.processingStatus as never }
          : {}),
        ...(patch.extractedText !== undefined ? { extractedText: patch.extractedText } : {}),
        ...(patch.pageCount !== undefined ? { pageCount: patch.pageCount } : {}),
        ...(patch.retentionUntil !== undefined ? { retentionUntil: patch.retentionUntil } : {}),
        ...(patch.legalHoldReason !== undefined ? { legalHoldReason: patch.legalHoldReason } : {}),
      })
      .where(tenantWhere(documents.agencyId, agencyId, eq(documents.id, id)))
      .returning();
    if (!rows[0]) throw new NotFoundError("Document", id);
    return this.toDocument(rows[0]);
  }
  async setDocumentEmbedding(
    agencyId: string,
    id: string,
    embedding: number[],
    content: string,
  ): Promise<void> {
    // The archive-entry vector is chunk 0 of the document (§5 document_chunks).
    await this.db
      .insert(documentChunks)
      .values({ agencyId, documentId: id, chunkIndex: 0, content, embedding })
      .onConflictDoUpdate({
        target: [documentChunks.documentId, documentChunks.chunkIndex],
        set: { content, embedding },
      });
  }
  async setDocumentBodyChunks(
    agencyId: string,
    documentId: string,
    chunks: { content: string; embedding: number[] }[],
  ): Promise<void> {
    // Replace-in-place: body chunks are derived data, so re-chunking a
    // document must not leave stale spans behind. Chunk 0 (the archive-entry
    // vector) is deliberately untouched.
    await this.db
      .delete(documentChunks)
      .where(
        tenantWhere(
          documentChunks.agencyId,
          agencyId,
          eq(documentChunks.documentId, documentId),
          sql`${documentChunks.chunkIndex} > 0`,
        ),
      );
    if (chunks.length === 0) return;
    await this.db.insert(documentChunks).values(
      chunks.map((c, i) => ({
        agencyId,
        documentId,
        chunkIndex: i + 1,
        content: c.content,
        embedding: c.embedding,
      })),
    );
  }
  async listBodyChunkEmbeddings(
    agencyId: string,
  ): Promise<{ documentId: string; chunkIndex: number; content: string; embedding: number[] }[]> {
    const rows = await this.db
      .select({
        documentId: documentChunks.documentId,
        chunkIndex: documentChunks.chunkIndex,
        content: documentChunks.content,
        embedding: documentChunks.embedding,
      })
      .from(documentChunks)
      .where(
        tenantWhere(
          documentChunks.agencyId,
          agencyId,
          sql`${documentChunks.chunkIndex} > 0`,
          sql`${documentChunks.embedding} is not null`,
        ),
      );
    // The `is not null` filter above guarantees the vector, but the column
    // type is nullable — narrow rather than assert.
    return rows.flatMap(
      (r: { documentId: string; chunkIndex: number; content: string; embedding: number[] | null }) =>
        r.embedding
          ? [{ documentId: r.documentId, chunkIndex: r.chunkIndex, content: r.content, embedding: r.embedding }]
          : [],
    );
  }
  async listDocumentIdsWithBodyChunks(agencyId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ documentId: documentChunks.documentId })
      .from(documentChunks)
      .where(tenantWhere(documentChunks.agencyId, agencyId, sql`${documentChunks.chunkIndex} > 0`));
    return rows.map((r: { documentId: string }) => r.documentId);
  }
  async listPublicDocumentEmbeddings(agencyId: string): Promise<{ id: string; embedding: number[] }[]> {
    const rows = await this.db
      .select({ id: documentChunks.documentId, embedding: documentChunks.embedding })
      .from(documentChunks)
      .innerJoin(documents, eq(documentChunks.documentId, documents.id))
      .where(
        tenantWhere(
          documentChunks.agencyId,
          agencyId,
          eq(documents.classification, "public"), // invariant 3 at the query layer
          eq(documentChunks.chunkIndex, 0),
          sql`${documentChunks.embedding} is not null`,
        ),
      );
    return rows
      .filter((r: { id: string; embedding: number[] | null }) => r.embedding != null)
      .map((r: { id: string; embedding: number[] | null }) => ({ id: r.id, embedding: r.embedding! }));
  }
  async findReleaseContainingDocument(agencyId: string, documentId: string): Promise<ReleaseEntity | null> {
    // jsonb containment: artifacts @> [{"documentId": "..."}]
    const [r] = await this.db
      .select()
      .from(releases)
      .where(
        tenantWhere(
          releases.agencyId,
          agencyId,
          sql`${releases.artifacts} @> ${JSON.stringify([{ documentId }])}::jsonb`,
        ),
      )
      .limit(1);
    if (!r) return null;
    return {
      id: r.id,
      agencyId: r.agencyId,
      requestId: r.requestId,
      artifacts: (r.artifacts ?? []) as ReleaseEntity["artifacts"],
      responseLetter: r.responseLetter,
      visibility: r.visibility,
      approvedByUserId: r.approvedByUserId,
      releasedAt: r.releasedAt,
    };
  }
  async findLatestDocumentByExternalId(agencyId: string, externalSystemId: string): Promise<DocumentEntity | null> {
    const [d] = await this.db
      .select()
      .from(documents)
      .where(tenantWhere(documents.agencyId, agencyId, eq(documents.externalSystemId, externalSystemId)))
      .orderBy(desc(documents.createdAt))
      .limit(1);
    return d ? this.toDocument(d) : null;
  }
  async linkRequestDocument(agencyId: string, requestId: string, documentId: string): Promise<void> {
    void agencyId; // both FK targets are already tenant-scoped rows
    await this.db
      .insert(requestDocuments)
      .values({ requestId, documentId })
      .onConflictDoNothing();
  }
  async listRequestDocuments(agencyId: string, requestId: string): Promise<DocumentEntity[]> {
    const rows = await this.db
      .select({ doc: documents })
      .from(requestDocuments)
      .innerJoin(documents, eq(requestDocuments.documentId, documents.id))
      .where(tenantWhere(documents.agencyId, agencyId, eq(requestDocuments.requestId, requestId)));
    return rows.map((r: { doc: typeof documents.$inferSelect }) => this.toDocument(r.doc));
  }

  async upsertReview(r: ReviewEntity): Promise<ReviewEntity> {
    await this.db
      .insert(reviews)
      .values({
        id: r.id,
        agencyId: r.agencyId,
        requestId: r.requestId,
        documentId: r.documentId,
        decision: r.decision,
        exemptionLabel: r.exemptionLabel,
        decidedByUserId: r.decidedByUserId,
        createdAt: r.createdAt,
      })
      .onConflictDoUpdate({
        target: [reviews.requestId, reviews.documentId],
        set: { decision: r.decision, exemptionLabel: r.exemptionLabel, decidedByUserId: r.decidedByUserId },
      });
    return r;
  }
  async listReviews(agencyId: string, requestId: string): Promise<ReviewEntity[]> {
    const rows = await this.db
      .select()
      .from(reviews)
      .where(tenantWhere(reviews.agencyId, agencyId, eq(reviews.requestId, requestId)));
    return rows.map((r: typeof reviews.$inferSelect) => ({
      id: r.id,
      agencyId: r.agencyId,
      requestId: r.requestId,
      documentId: r.documentId,
      decision: r.decision,
      exemptionLabel: r.exemptionLabel,
      decidedByUserId: r.decidedByUserId ?? "",
      createdAt: r.createdAt,
    }));
  }

  async createRelease(r: ReleaseEntity): Promise<ReleaseEntity> {
    await this.db.insert(releases).values({
      id: r.id,
      agencyId: r.agencyId,
      requestId: r.requestId,
      artifacts: r.artifacts,
      responseLetter: r.responseLetter,
      visibility: r.visibility,
      approvedByUserId: r.approvedByUserId,
      releasedAt: r.releasedAt,
    });
    return r;
  }
  async listReleases(agencyId: string, requestId: string): Promise<ReleaseEntity[]> {
    const rows = await this.db
      .select()
      .from(releases)
      .where(tenantWhere(releases.agencyId, agencyId, eq(releases.requestId, requestId)));
    return rows.map((r: typeof releases.$inferSelect) => ({
      id: r.id,
      agencyId: r.agencyId,
      requestId: r.requestId,
      artifacts: (r.artifacts ?? []) as ReleaseEntity["artifacts"],
      responseLetter: r.responseLetter,
      visibility: r.visibility,
      approvedByUserId: r.approvedByUserId,
      releasedAt: r.releasedAt,
    }));
  }

  async getReleaseById(agencyId: string, releaseId: string): Promise<ReleaseEntity | null> {
    const [r] = await this.db
      .select()
      .from(releases)
      .where(tenantWhere(releases.agencyId, agencyId, eq(releases.id, releaseId)))
      .limit(1);
    if (!r) return null;
    return {
      id: r.id,
      agencyId: r.agencyId,
      requestId: r.requestId,
      artifacts: (r.artifacts ?? []) as ReleaseEntity["artifacts"],
      responseLetter: r.responseLetter,
      visibility: r.visibility,
      approvedByUserId: r.approvedByUserId,
      releasedAt: r.releasedAt,
    };
  }

  async appendDeflection(d: DeflectionEntity): Promise<DeflectionEntity> {
    await this.db.insert(deflections).values({
      id: d.id,
      agencyId: d.agencyId,
      kind: d.kind,
      query: d.query,
      documentId: d.documentId,
      estimatedStaffHoursAvoided: d.estimatedStaffHoursAvoided,
      createdAt: d.createdAt,
    });
    return d;
  }
  async listDeflections(agencyId: string): Promise<DeflectionEntity[]> {
    const rows = await this.db.select().from(deflections).where(eq(deflections.agencyId, agencyId));
    return rows.map((d: typeof deflections.$inferSelect) => ({
      id: d.id,
      agencyId: d.agencyId,
      kind: d.kind as DeflectionEntity["kind"],
      query: d.query,
      documentId: d.documentId,
      estimatedStaffHoursAvoided: d.estimatedStaffHoursAvoided ?? 0,
      createdAt: d.createdAt,
    }));
  }
}
