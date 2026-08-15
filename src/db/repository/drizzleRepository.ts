/**
 * Drizzle-backed Repository (spec §3/§10) — the one adapter that runs on BOTH
 * embedded PGlite and a managed Postgres, because both speak the same pg dialect
 * and share this schema. Business logic (services) depends only on the port, so
 * nothing above this file changes when the backend does.
 *
 * Tenant isolation is enforced in every read: queries AND `agency_id` in, and a
 * row from another agency is invisible.
 */
import { and, asc, cosineDistance, desc, eq, inArray, isNotNull, isNull, lt, lte, ne, notExists, notLike, or, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import {
  adminEvents,
  agencies,
  agencyDirectory,
  agentRuns,
  authTokens,
  datasetRows,
  deflections,
  deliveries,
  demoRequests,
  departments,
  documentChunks,
  documents,
  jobs,
  messages,
  networkAggregates,
  publicationDecisions,
  publicIdCounters,
  releases,
  requestPlays,
  requestDocuments,
  requestEvents,
  requesters,
  requests,
  reviews,
  sources,
  tasks,
  userDepartments,
  users,
} from "@/db/schema";
import { tenantWhere } from "@/db/tenant";
import {
  NotFoundError,
  type AdminEventEntity,
  type Agency,
  type AgentRunEntity,
  type AuthTokenEntity,
  type DatasetRowEntity,
  type DeflectionEntity,
  type DemoRequestEntity,
  type NetworkAggregateEntity,
  type PlatformAgencyStats,
  type DeliveryEntity,
  type Department,
  type DirectoryEntry,
  type DocumentEntity,
  type EventEntity,
  type JobRecord,
  type JobStatus,
  type MessageEntity,
  type PlayEntity,
  type PublicationDecisionRow,
  type PublicationState,
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
      // These three were silently DROPPED here until 2026-08-15 while
      // InMemory persisted them — a create-time divergence no unit test could
      // see, since unit tests only ever exercise InMemory. Found when a
      // freshly created agency's settings came back empty on PGlite.
      // Conformance now pins it.
      defaultRoutingRules: a.defaultRoutingRules ?? null,
      branding: a.branding ?? null,
      portalSettings: a.settings ?? null,
    });
    return a;
  }
  async updateAgency(
    agencyId: string,
    patch: Partial<Pick<Agency, "name" | "workflowSettings" | "defaultRoutingRules" | "branding" | "settings">>,
  ): Promise<Agency> {
    const set: Record<string, unknown> = {};
    if (patch.name != null && patch.name.trim()) set.name = patch.name;
    if ("workflowSettings" in patch) set.workflowSettings = patch.workflowSettings ?? null;
    if ("defaultRoutingRules" in patch) set.defaultRoutingRules = patch.defaultRoutingRules ?? null;
    if ("branding" in patch) set.branding = patch.branding ?? null;
    if ("settings" in patch) set.portalSettings = patch.settings ?? null;
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
      branding: a.branding ?? null,
      settings: a.portalSettings ?? null,
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

  async createDepartment(d: Department): Promise<Department> {
    await this.db.insert(departments).values({
      id: d.id,
      agencyId: d.agencyId,
      name: d.name,
      defaultResponderEmails: d.defaultResponderEmails,
    });
    return d;
  }

  async updateDepartment(
    agencyId: string,
    id: string,
    patch: Partial<Omit<Department, "id" | "agencyId">>,
  ): Promise<Department> {
    const set: Record<string, unknown> = {};
    for (const k of ["name", "defaultResponderEmails"] as const) {
      if (k in patch) set[k] = patch[k];
    }
    const rows = await this.db
      .update(departments)
      .set(set)
      .where(tenantWhere(departments.agencyId, agencyId, eq(departments.id, id)))
      .returning();
    if (!rows[0]) throw new NotFoundError("Department", id);
    const d = rows[0] as typeof departments.$inferSelect;
    return {
      id: d.id,
      agencyId: d.agencyId,
      name: d.name,
      defaultResponderEmails: d.defaultResponderEmails ?? [],
    };
  }

  async listUserDepartmentIds(agencyId: string, userId: string): Promise<string[]> {
    // The join table carries no agency column; scope through the user row.
    const rows = await this.db
      .select({ departmentId: userDepartments.departmentId })
      .from(userDepartments)
      .innerJoin(users, eq(users.id, userDepartments.userId))
      .where(tenantWhere(users.agencyId, agencyId, eq(userDepartments.userId, userId)));
    return rows.map((r: { departmentId: string }) => r.departmentId);
  }

  async setUserDepartments(agencyId: string, userId: string, departmentIds: string[]): Promise<void> {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(tenantWhere(users.agencyId, agencyId, eq(users.id, userId)))
      .limit(1);
    if (!user) throw new NotFoundError("User", userId);
    // Only this agency's departments can be attached.
    const valid = await this.db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.agencyId, agencyId));
    const validIds = new Set(valid.map((d: { id: string }) => d.id));
    const keep = departmentIds.filter((id) => validIds.has(id));
    await this.db.delete(userDepartments).where(eq(userDepartments.userId, userId));
    if (keep.length > 0) {
      await this.db
        .insert(userDepartments)
        .values(keep.map((departmentId) => ({ userId, departmentId })));
    }
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
  async setRequestEmbedding(agencyId: string, id: string, embedding: number[]): Promise<void> {
    const rows = await this.db
      .update(requests)
      .set({ embedding })
      .where(tenantWhere(requests.agencyId, agencyId, eq(requests.id, id)))
      .returning({ id: requests.id });
    if (!rows[0]) throw new NotFoundError("Request", id);
  }
  async listRequestEmbeddings(agencyId: string): Promise<{ id: string; embedding: number[] }[]> {
    const rows = await this.db
      .select({ id: requests.id, embedding: requests.embedding })
      .from(requests)
      .where(tenantWhere(requests.agencyId, agencyId, sql`${requests.embedding} is not null`));
    return rows.filter(
      (r: { id: string; embedding: number[] | null }): r is { id: string; embedding: number[] } =>
        r.embedding != null,
    );
  }
  async getRequestEmbedding(agencyId: string, id: string): Promise<number[] | null> {
    const [row] = await this.db
      .select({ embedding: requests.embedding })
      .from(requests)
      .where(tenantWhere(requests.agencyId, agencyId, eq(requests.id, id)))
      .limit(1);
    return row?.embedding ?? null;
  }
  async searchRequestEmbeddings(
    agencyId: string,
    queryVec: number[],
    opts: { limit: number; excludeRequestId?: string; interpretedOnly?: boolean },
  ): Promise<{ id: string; similarity: number }[]> {
    // ORDER BY the distance expression directly so the HNSW index drives the
    // scan; the agency/null filters post-filter its candidates.
    const distance = cosineDistance(requests.embedding, queryVec);
    const rows = await this.db
      .select({ id: requests.id, similarity: sql<number>`1 - (${distance})` })
      .from(requests)
      .where(
        tenantWhere(
          requests.agencyId,
          agencyId,
          sql`${requests.embedding} is not null`,
          ...(opts.excludeRequestId ? [ne(requests.id, opts.excludeRequestId)] : []),
          ...(opts.interpretedOnly ? [isNotNull(requests.interpretedScope)] : []),
        ),
      )
      .orderBy(distance)
      .limit(opts.limit);
    return rows.map((r: { id: string; similarity: number | string }) => ({
      id: r.id,
      similarity: Number(r.similarity),
    }));
  }
  async listRequestsWithoutEmbedding(agencyId: string): Promise<RequestEntity[]> {
    const rows = await this.db
      .select()
      .from(requests)
      .where(tenantWhere(requests.agencyId, agencyId, isNull(requests.embedding)))
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
          // Re-pushes that carry bytes refresh them; undefined fields are
          // skipped by drizzle, so metadata-only re-pushes leave bytes alone.
          blobRef: doc.blobRef ?? undefined,
          byteSize: doc.byteSize ?? undefined,
          mimeType: doc.mimeType ?? undefined,
          checksum: doc.checksum ?? undefined,
          extractedText: doc.extractedText ?? undefined,
          pageCount: doc.pageCount ?? undefined,
        })
        .where(eq(documents.id, existing.id))
        .returning();
      return { document: this.toDocument(rows[0]!), created: false };
    }

    await this.db.insert(documents).values({
      id: doc.id,
      agencyId: doc.agencyId,
      sourceId: doc.sourceId,
      provenance: doc.provenance ?? "connector",
      blobRef: doc.blobRef ?? doc.filename ?? doc.externalSystemId ?? doc.id,
      byteSize: doc.byteSize,
      mimeType: doc.mimeType,
      checksum: doc.checksum,
      extractedText: doc.extractedText,
      pageCount: doc.pageCount,
      retentionUntil: doc.retentionUntil,
      legalHoldReason: doc.legalHoldReason,
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
      provenance: d.provenance,
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

  async listDocumentsUnderRetention(agencyId: string): Promise<DocumentEntity[]> {
    const rows = await this.db
      .select()
      .from(documents)
      .where(
        tenantWhere(
          documents.agencyId,
          agencyId,
          or(isNotNull(documents.retentionUntil), isNotNull(documents.legalHoldReason)),
        ),
      )
      .orderBy(desc(documents.createdAt));
    return rows.map((d: typeof documents.$inferSelect) => this.toDocument(d));
  }

  // --- durable job queue ---------------------------------------------------

  async createJob(j: JobRecord): Promise<JobRecord> {
    await this.db.insert(jobs).values({
      id: j.id,
      kind: j.kind,
      payload: j.payload,
      status: j.status,
      attempts: j.attempts,
      maxAttempts: j.maxAttempts,
      lastError: j.lastError,
      runAfter: j.runAfter,
      createdAt: j.createdAt,
    });
    return j;
  }

  async claimNextJob(now: Date): Promise<JobRecord | null> {
    // SELECT ... FOR UPDATE SKIP LOCKED inside a transaction: two workers
    // can never claim the same row, and neither blocks the other.
    return this.db.transaction(async (tx: Db) => {
      const [candidate] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.status, "queued"), lte(jobs.runAfter, now)))
        .orderBy(asc(jobs.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!candidate) return null;
      const [row] = await tx
        .update(jobs)
        .set({ status: "running", startedAt: now, attempts: sql`${jobs.attempts} + 1` })
        .where(eq(jobs.id, candidate.id))
        .returning();
      return row ? this.toJob(row) : null;
    });
  }

  async completeJob(id: string, at: Date): Promise<void> {
    await this.db.update(jobs).set({ status: "done", finishedAt: at }).where(eq(jobs.id, id));
  }

  async retryJob(id: string, error: string, runAfter: Date): Promise<void> {
    await this.db
      .update(jobs)
      .set({ status: "queued", lastError: error, runAfter })
      .where(eq(jobs.id, id));
  }

  async markJobFailed(id: string, error: string, at: Date): Promise<void> {
    await this.db
      .update(jobs)
      .set({ status: "failed", lastError: error, finishedAt: at })
      .where(eq(jobs.id, id));
  }

  async resetRunningJobs(): Promise<number> {
    const rows = await this.db
      .update(jobs)
      .set({ status: "queued" })
      .where(eq(jobs.status, "running"))
      .returning({ id: jobs.id });
    return rows.length;
  }

  async listJobs(opts?: { status?: JobStatus; limit?: number }): Promise<JobRecord[]> {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(opts?.status ? eq(jobs.status, opts.status) : undefined)
      .orderBy(desc(jobs.createdAt))
      .limit(opts?.limit ?? 100);
    return rows.map((r: typeof jobs.$inferSelect) => this.toJob(r));
  }

  private toJob(r: typeof jobs.$inferSelect): JobRecord {
    return {
      id: r.id,
      kind: r.kind,
      payload: r.payload ?? {},
      status: r.status as JobStatus,
      attempts: r.attempts,
      maxAttempts: r.maxAttempts,
      lastError: r.lastError,
      runAfter: r.runAfter,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      createdAt: r.createdAt,
    };
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

  async appendPublicationDecision(d: PublicationDecisionRow): Promise<PublicationDecisionRow> {
    await this.db.insert(publicationDecisions).values({
      id: d.id,
      agencyId: d.agencyId,
      documentId: d.documentId,
      decision: d.decision,
      byUserId: d.byUserId,
      byName: d.byName,
      reason: d.reason,
      createdAt: d.createdAt,
    });
    return d;
  }
  async listPublicationDecisions(agencyId: string, documentId?: string): Promise<PublicationDecisionRow[]> {
    const rows = await this.db
      .select()
      .from(publicationDecisions)
      .where(
        tenantWhere(
          publicationDecisions.agencyId,
          agencyId,
          documentId ? eq(publicationDecisions.documentId, documentId) : undefined,
        ),
      )
      .orderBy(desc(publicationDecisions.createdAt));
    return rows.map((r: typeof publicationDecisions.$inferSelect) => ({
      id: r.id,
      agencyId: r.agencyId,
      documentId: r.documentId,
      decision: r.decision,
      byUserId: r.byUserId,
      byName: r.byName,
      reason: r.reason,
      createdAt: r.createdAt,
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
  async updateDeliveryRelay(id: string, status: "relayed" | "failed", error?: string): Promise<void> {
    await this.db
      .update(deliveries)
      .set({ relayStatus: status, relayError: error ?? null })
      .where(eq(deliveries.id, id));
  }
  async listFailedDeliveries(limit = 50): Promise<DeliveryEntity[]> {
    const rows = await this.db
      .select()
      .from(deliveries)
      .where(eq(deliveries.relayStatus, "failed"))
      .orderBy(desc(deliveries.createdAt))
      .limit(limit);
    return rows.map((d: typeof deliveries.$inferSelect) => this.toDelivery(d));
  }
  async listDeliveries(agencyId: string, limit = 50): Promise<DeliveryEntity[]> {
    const rows = await this.db
      .select()
      .from(deliveries)
      .where(eq(deliveries.agencyId, agencyId))
      .orderBy(desc(deliveries.createdAt))
      .limit(limit);
    return rows.map((d: typeof deliveries.$inferSelect) => this.toDelivery(d));
  }
  private toDelivery(d: typeof deliveries.$inferSelect): DeliveryEntity {
    return {
      id: d.id,
      agencyId: d.agencyId,
      toEmail: d.toEmail,
      subject: d.subject,
      body: d.body,
      kind: d.kind,
      requestId: d.requestId,
      taskId: d.taskId,
      relayStatus: (d.relayStatus as DeliveryEntity["relayStatus"]) ?? null,
      relayError: d.relayError ?? null,
      createdAt: d.createdAt,
    };
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
      connectorKind: s.connectorKind ?? null,
      syncSchedule: s.syncSchedule ?? null,
      mappingConfig: s.mappingConfig ?? null,
      lastSyncAt: s.lastSyncAt ?? null,
      lastSyncStatus: s.lastSyncStatus ?? "never",
      lastSyncError: s.lastSyncError ?? null,
    });
    return (await this.listSources(s.agencyId)).find((x) => x.id === s.id) ?? s;
  }
  async findSourceByApiKeyHash(agencyId: string, apiKeyHash: string): Promise<SourceEntity | null> {
    const [s] = await this.db
      .select()
      .from(sources)
      .where(tenantWhere(sources.agencyId, agencyId, eq(sources.credentialsRef, `sha256:${apiKeyHash}`)))
      .limit(1);
    if (!s) return null;
    return this.toSource(s);
  }
  private toSource(s: typeof sources.$inferSelect): SourceEntity {
    return {
      id: s.id,
      agencyId: s.agencyId,
      name: s.name,
      type: s.type,
      apiKeyHash: s.credentialsRef?.startsWith("sha256:") ? s.credentialsRef.slice("sha256:".length) : null,
      trust: s.trust,
      defaultClassification: s.defaultClassification,
      connectorKind: s.connectorKind,
      syncSchedule: s.syncSchedule,
      mappingConfig: s.mappingConfig ?? null,
      lastSyncAt: s.lastSyncAt,
      lastSyncStatus: s.lastSyncStatus,
      lastSyncError: s.lastSyncError,
    };
  }
  async listSources(agencyId: string): Promise<SourceEntity[]> {
    const rows = await this.db.select().from(sources).where(eq(sources.agencyId, agencyId));
    return rows.map((s: typeof sources.$inferSelect) => this.toSource(s));
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
  ): Promise<SourceEntity> {
    const rows = await this.db
      .update(sources)
      .set({
        name: patch.name,
        trust: patch.trust,
        defaultClassification: patch.defaultClassification,
        // apiKeyHash present in the patch (even as null) replaces the credential.
        ...("apiKeyHash" in patch
          ? { credentialsRef: patch.apiKeyHash ? `sha256:${patch.apiKeyHash}` : null }
          : {}),
        // Nullable fields update only when the key is present in the patch,
        // so "not mentioned" and "set to null" stay distinct acts.
        ...("syncSchedule" in patch ? { syncSchedule: patch.syncSchedule ?? null } : {}),
        ...("mappingConfig" in patch ? { mappingConfig: patch.mappingConfig ?? null } : {}),
        ...("lastSyncAt" in patch ? { lastSyncAt: patch.lastSyncAt ?? null } : {}),
        ...(patch.lastSyncStatus ? { lastSyncStatus: patch.lastSyncStatus } : {}),
        ...("lastSyncError" in patch ? { lastSyncError: patch.lastSyncError ?? null } : {}),
      })
      .where(tenantWhere(sources.agencyId, agencyId, eq(sources.id, id)))
      .returning();
    if (!rows[0]) throw new NotFoundError("Source", id);
    return this.toSource(rows[0]);
  }
  async deleteSource(agencyId: string, id: string): Promise<void> {
    // documents.source_id is ON DELETE SET NULL — the corpus survives.
    const rows = await this.db
      .delete(sources)
      .where(tenantWhere(sources.agencyId, agencyId, eq(sources.id, id)))
      .returning({ id: sources.id });
    if (!rows[0]) throw new NotFoundError("Source", id);
  }

  async listAttachedDocumentIds(agencyId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ documentId: requestDocuments.documentId })
      .from(requestDocuments)
      .innerJoin(documents, eq(requestDocuments.documentId, documents.id))
      .where(eq(documents.agencyId, agencyId));
    return rows.map((r: { documentId: string }) => r.documentId);
  }

  /** The publication queue's eligibility + state predicate, in SQL. */
  private publicationStateWhere(agencyId: string, state: PublicationState) {
    const eligible = and(
      eq(documents.agencyId, agencyId),
      // Attached docs belong to the request review flow.
      notExists(
        this.db.select({ one: sql`1` }).from(requestDocuments).where(eq(requestDocuments.documentId, documents.id)),
      ),
      // Release artifacts are managed by the release flow.
      or(isNull(documents.externalSystemId), notLike(documents.externalSystemId, "redacted:%")),
      ne(documents.provenance, "prior_release"),
    );
    const decided = sql`${documents.metadata}->'publicationDecision' is not null`;
    if (state === "published") return and(eligible, eq(documents.classification, "public"));
    if (state === "undecided") {
      return and(eligible, eq(documents.classification, "internal"), sql`not (${decided})`);
    }
    return and(eligible, eq(documents.classification, "internal"), decided);
  }
  async countPublicationStates(agencyId: string): Promise<Record<PublicationState, number>> {
    const count = async (state: PublicationState) => {
      const [row] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(documents)
        .where(this.publicationStateWhere(agencyId, state));
      return row?.n ?? 0;
    };
    const [undecided, published, keptInternal] = await Promise.all([
      count("undecided"),
      count("published"),
      count("kept_internal"),
    ]);
    return { undecided, published, kept_internal: keptInternal };
  }
  async listPublicationDocuments(
    agencyId: string,
    state: PublicationState,
    opts: { limit: number; before?: { createdAt: Date; id: string } },
  ): Promise<DocumentEntity[]> {
    const rows = await this.db
      .select()
      .from(documents)
      .where(
        and(
          this.publicationStateWhere(agencyId, state),
          opts.before
            ? or(
                lt(documents.createdAt, opts.before.createdAt),
                and(eq(documents.createdAt, opts.before.createdAt), lt(documents.id, opts.before.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(documents.createdAt), desc(documents.id))
      .limit(opts.limit);
    return rows.map((d: typeof documents.$inferSelect) => this.toDocument(d));
  }
  async setDocumentClassification(
    agencyId: string,
    id: string,
    classification: "public" | "internal",
  ): Promise<DocumentEntity> {
    const rows = await this.db
      .update(documents)
      .set({ classification })
      .where(tenantWhere(documents.agencyId, agencyId, eq(documents.id, id)))
      .returning();
    if (!rows[0]) throw new NotFoundError("Document", id);
    return this.toDocument(rows[0]);
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
      retentionUntil: doc.retentionUntil,
      legalHoldReason: doc.legalHoldReason,
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
  async searchBodyChunkEmbeddings(
    agencyId: string,
    queryVec: number[],
    limit: number,
  ): Promise<{ documentId: string; chunkIndex: number; content: string; similarity: number }[]> {
    const distance = cosineDistance(documentChunks.embedding, queryVec);
    const rows = await this.db
      .select({
        documentId: documentChunks.documentId,
        chunkIndex: documentChunks.chunkIndex,
        content: documentChunks.content,
        similarity: sql<number>`1 - (${distance})`,
      })
      .from(documentChunks)
      .where(
        tenantWhere(
          documentChunks.agencyId,
          agencyId,
          sql`${documentChunks.chunkIndex} > 0`,
          sql`${documentChunks.embedding} is not null`,
        ),
      )
      .orderBy(distance)
      .limit(limit);
    return rows.map(
      (r: { documentId: string; chunkIndex: number; content: string; similarity: number | string }) => ({
        documentId: r.documentId,
        chunkIndex: r.chunkIndex,
        content: r.content,
        similarity: Number(r.similarity),
      }),
    );
  }
  async searchPublicDocumentEmbeddings(
    agencyId: string,
    queryVec: number[],
    limit: number,
  ): Promise<{ id: string; similarity: number }[]> {
    const distance = cosineDistance(documentChunks.embedding, queryVec);
    const rows = await this.db
      .select({ id: documentChunks.documentId, similarity: sql<number>`1 - (${distance})` })
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
      )
      .orderBy(distance)
      .limit(limit);
    return rows.map((r: { id: string; similarity: number | string }) => ({
      id: r.id,
      similarity: Number(r.similarity),
    }));
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

  async listRequestDocumentsForRequests(
    agencyId: string,
    requestIds: string[],
  ): Promise<Array<{ requestId: string; document: DocumentEntity }>> {
    if (requestIds.length === 0) return [];
    const rows = await this.db
      .select({ requestId: requestDocuments.requestId, doc: documents })
      .from(requestDocuments)
      .innerJoin(documents, eq(requestDocuments.documentId, documents.id))
      .where(tenantWhere(documents.agencyId, agencyId, inArray(requestDocuments.requestId, requestIds)));
    return rows.map((r: { requestId: string; doc: typeof documents.$inferSelect }) => ({
      requestId: r.requestId,
      document: this.toDocument(r.doc),
    }));
  }

  async upsertReview(r: ReviewEntity): Promise<ReviewEntity> {
    // .returning() so a re-decide reports the STORED row — on conflict the
    // original row (and id) survives; returning the input would fabricate an
    // id that exists nowhere (the InMemory adapter always kept the stored id).
    const rows = await this.db
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
      })
      .returning();
    const row = rows[0]!;
    return {
      id: row.id,
      agencyId: row.agencyId,
      requestId: row.requestId,
      documentId: row.documentId,
      decision: row.decision,
      exemptionLabel: row.exemptionLabel,
      decidedByUserId: row.decidedByUserId ?? "",
      createdAt: row.createdAt,
    };
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
  async listAgencyReviews(agencyId: string): Promise<ReviewEntity[]> {
    const rows = await this.db
      .select()
      .from(reviews)
      .where(tenantWhere(reviews.agencyId, agencyId));
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

  async listAllReleases(agencyId: string): Promise<ReleaseEntity[]> {
    const rows = await this.db
      .select()
      .from(releases)
      .where(tenantWhere(releases.agencyId, agencyId))
      .orderBy(desc(releases.releasedAt));
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

  // Walkthrough requests are PLATFORM-level: no tenantWhere here on purpose —
  // the person who submitted one has no agency yet (see schema comment).
  async createDemoRequest(d: DemoRequestEntity): Promise<DemoRequestEntity> {
    await this.db.insert(demoRequests).values({
      id: d.id,
      name: d.name,
      email: d.email,
      organization: d.organization,
      role: d.role,
      stateCode: d.stateCode,
      notes: d.notes,
      source: d.source,
      createdAt: d.createdAt,
    });
    return d;
  }
  async listDemoRequests(limit = 100): Promise<DemoRequestEntity[]> {
    const rows = await this.db
      .select()
      .from(demoRequests)
      .orderBy(desc(demoRequests.createdAt))
      .limit(limit);
    return rows.map((r: typeof demoRequests.$inferSelect) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      organization: r.organization,
      role: r.role,
      stateCode: r.stateCode,
      notes: r.notes,
      source: r.source,
      createdAt: r.createdAt,
    }));
  }

  async listPlatformAgencyStats(now: Date): Promise<Record<string, PlatformAgencyStats>> {
    const blank = (): PlatformAgencyStats => ({
      requestCount: 0,
      openCount: 0,
      overdueCount: 0,
      staffCount: 0,
      residentCount: 0,
      directoryCount: 0,
      peerLinkCount: 0,
      departmentCount: 0,
      publicRecordCount: 0,
    });

    // One GROUP BY per table — six queries total, independent of tenant
    // count. (The console previously ran six per TENANT, each loading the
    // whole table only to read its length.)
    const [agencyRows, requestRows, userRows, requesterRows, directoryRows, deptRows, docRows] =
      await Promise.all([
        this.db.select({ id: agencies.id }).from(agencies),
        this.db
          .select({
            agencyId: requests.agencyId,
            total: sql<number>`count(*)::int`,
            open: sql<number>`count(*) filter (where ${requests.closedAt} is null)::int`,
            overdue: sql<number>`count(*) filter (where ${requests.closedAt} is null and ${requests.statutoryDueAt} is not null and ${requests.statutoryDueAt} < ${now})::int`,
          })
          .from(requests)
          .groupBy(requests.agencyId),
        this.db
          .select({ agencyId: users.agencyId, total: sql<number>`count(*)::int` })
          .from(users)
          .groupBy(users.agencyId),
        this.db
          .select({
            agencyId: requesters.agencyId,
            residents: sql<number>`count(*) filter (where ${requesters.passwordHash} is not null)::int`,
          })
          .from(requesters)
          .groupBy(requesters.agencyId),
        this.db
          .select({
            agencyId: agencyDirectory.agencyId,
            total: sql<number>`count(*)::int`,
            peers: sql<number>`count(*) filter (where ${agencyDirectory.peerAgencyId} is not null)::int`,
          })
          .from(agencyDirectory)
          .groupBy(agencyDirectory.agencyId),
        this.db
          .select({ agencyId: departments.agencyId, total: sql<number>`count(*)::int` })
          .from(departments)
          .groupBy(departments.agencyId),
        this.db
          .select({
            agencyId: documents.agencyId,
            publicCount: sql<number>`count(*) filter (where ${documents.classification} = 'public')::int`,
          })
          .from(documents)
          .groupBy(documents.agencyId),
      ]);

    const out: Record<string, PlatformAgencyStats> = {};
    // Seed from agencies so a tenant with nothing in it still appears.
    for (const a of agencyRows as { id: string }[]) out[a.id] = blank();
    const bucket = (agencyId: string) => (out[agencyId] ??= blank());

    for (const r of requestRows as { agencyId: string; total: number; open: number; overdue: number }[]) {
      const s = bucket(r.agencyId);
      s.requestCount = r.total;
      s.openCount = r.open;
      s.overdueCount = r.overdue;
    }
    for (const r of userRows as { agencyId: string; total: number }[]) {
      bucket(r.agencyId).staffCount = r.total;
    }
    for (const r of requesterRows as { agencyId: string; residents: number }[]) {
      bucket(r.agencyId).residentCount = r.residents;
    }
    for (const r of directoryRows as { agencyId: string; total: number; peers: number }[]) {
      const s = bucket(r.agencyId);
      s.directoryCount = r.total;
      s.peerLinkCount = r.peers;
    }
    for (const r of deptRows as { agencyId: string; total: number }[]) {
      bucket(r.agencyId).departmentCount = r.total;
    }
    for (const r of docRows as { agencyId: string; publicCount: number }[]) {
      bucket(r.agencyId).publicRecordCount = r.publicCount;
    }
    return out;
  }

  // --- network plays (docs/network-plays.md, invariant 11) -----------------

  async replaceNetworkAggregates(rows: NetworkAggregateEntity[]): Promise<void> {
    // Full replace: one current snapshot, never a published series.
    await this.db.delete(networkAggregates);
    if (rows.length === 0) return;
    await this.db.insert(networkAggregates).values(
      rows.map((r) => ({
        id: r.id,
        stateCode: r.stateCode,
        topic: r.topic,
        agencyCount: r.agencyCount,
        episodes: r.episodes,
        routes: r.routes,
        exemptionSections: r.exemptionSections,
        daysToClose: r.daysToClose,
        extensionRate: r.extensionRate,
        basis: r.basis,
        pendingAgencyCount: r.pendingAgencyCount,
        computedAt: r.computedAt,
      })),
    );
  }

  async listNetworkAggregates(): Promise<NetworkAggregateEntity[]> {
    const rows = await this.db
      .select()
      .from(networkAggregates)
      .orderBy(asc(networkAggregates.stateCode), asc(networkAggregates.topic));
    return rows.map((r: typeof networkAggregates.$inferSelect) => ({
      id: r.id,
      stateCode: r.stateCode,
      topic: r.topic,
      agencyCount: r.agencyCount,
      episodes: r.episodes,
      routes: r.routes ?? [],
      exemptionSections: r.exemptionSections ?? [],
      daysToClose: r.daysToClose,
      extensionRate: r.extensionRate,
      basis: r.basis,
      pendingAgencyCount: r.pendingAgencyCount,
      computedAt: r.computedAt,
    }));
  }

  // --- learning loop (docs/learning-loop.md) -------------------------------

  async replaceAgencyPlays(agencyId: string, rows: PlayEntity[]): Promise<void> {
    await this.db.delete(requestPlays).where(eq(requestPlays.agencyId, agencyId));
    const mine = rows.filter((p) => p.agencyId === agencyId);
    if (mine.length === 0) return;
    await this.db.insert(requestPlays).values(
      mine.map((p) => ({
        id: p.id,
        agencyId: p.agencyId,
        topic: p.topic,
        keywords: p.keywords,
        stats: p.stats,
        episodeCount: p.episodeCount,
        embedding: p.embedding ?? undefined,
        rebuiltAt: p.rebuiltAt,
        createdAt: p.createdAt,
      })),
    );
  }

  async listPlays(agencyId: string): Promise<PlayEntity[]> {
    const rows = await this.db
      .select()
      .from(requestPlays)
      .where(eq(requestPlays.agencyId, agencyId))
      .orderBy(desc(requestPlays.episodeCount));
    return rows.map((p: typeof requestPlays.$inferSelect) => ({
      id: p.id,
      agencyId: p.agencyId,
      topic: p.topic,
      keywords: p.keywords ?? [],
      stats: p.stats,
      episodeCount: p.episodeCount,
      embedding: p.embedding ?? null,
      rebuiltAt: p.rebuiltAt,
      createdAt: p.createdAt,
    }));
  }

  // --- dataset row store (connected-sources phase 3) -----------------------

  private toDatasetRow(r: typeof datasetRows.$inferSelect): DatasetRowEntity {
    return {
      id: r.id,
      agencyId: r.agencyId,
      documentId: r.documentId,
      dataset: r.dataset,
      period: r.period,
      rowIndex: r.rowIndex,
      recordDate: r.recordDate,
      data: r.data ?? {},
      createdAt: r.createdAt,
    };
  }

  async replaceDatasetRows(agencyId: string, documentId: string, rows: DatasetRowEntity[]): Promise<void> {
    await this.db
      .delete(datasetRows)
      .where(and(eq(datasetRows.agencyId, agencyId), eq(datasetRows.documentId, documentId)));
    const mine = rows.filter((r) => r.agencyId === agencyId && r.documentId === documentId);
    if (mine.length === 0) return;
    // Batched insert; slices can carry tens of thousands of rows and one
    // VALUES list that long overflows the wire protocol.
    const BATCH = 2000;
    for (let i = 0; i < mine.length; i += BATCH) {
      await this.db.insert(datasetRows).values(
        mine.slice(i, i + BATCH).map((r) => ({
          id: r.id,
          agencyId: r.agencyId,
          documentId: r.documentId,
          dataset: r.dataset,
          period: r.period,
          rowIndex: r.rowIndex,
          recordDate: r.recordDate,
          data: r.data,
          createdAt: r.createdAt,
        })),
      );
    }
  }

  async searchPublicDatasetRows(
    agencyId: string,
    opts: { dataset: string; from?: string; to?: string; limit: number },
  ): Promise<{ rows: DatasetRowEntity[]; total: number }> {
    // Invariant 3 lives HERE: the join to documents filters
    // classification='public' in the query, not in any caller.
    const conditions = [
      eq(datasetRows.agencyId, agencyId),
      eq(datasetRows.dataset, opts.dataset),
      eq(documents.classification, "public"),
      ...(opts.from ? [sql`${datasetRows.recordDate} >= ${opts.from}`] : []),
      ...(opts.to ? [sql`${datasetRows.recordDate} <= ${opts.to}`] : []),
    ];
    const [rows, totals] = await Promise.all([
      this.db
        .select({ row: datasetRows })
        .from(datasetRows)
        .innerJoin(documents, eq(datasetRows.documentId, documents.id))
        .where(and(...conditions))
        .orderBy(asc(datasetRows.recordDate), asc(datasetRows.rowIndex))
        .limit(opts.limit),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(datasetRows)
        .innerJoin(documents, eq(datasetRows.documentId, documents.id))
        .where(and(...conditions)),
    ]);
    return {
      rows: rows.map((r: { row: typeof datasetRows.$inferSelect }) => this.toDatasetRow(r.row)),
      total: totals[0]?.n ?? 0,
    };
  }

  async listPublicDatasetRowsForDocument(
    agencyId: string,
    documentId: string,
    limit: number,
  ): Promise<DatasetRowEntity[]> {
    const rows = await this.db
      .select({ row: datasetRows })
      .from(datasetRows)
      .innerJoin(documents, eq(datasetRows.documentId, documents.id))
      .where(
        and(
          eq(datasetRows.agencyId, agencyId),
          eq(datasetRows.documentId, documentId),
          eq(documents.classification, "public"),
        ),
      )
      .orderBy(asc(datasetRows.rowIndex))
      .limit(limit);
    return rows.map((r: { row: typeof datasetRows.$inferSelect }) => this.toDatasetRow(r.row));
  }

  async searchAgencyDatasetRows(
    agencyId: string,
    opts: { dataset: string; from?: string; to?: string; limit: number },
  ): Promise<{ rows: DatasetRowEntity[]; total: number }> {
    // Staff scope — no classification join/filter (tenant isolation only);
    // see the port doc comment for why this must stay off requester surfaces.
    const conditions = [
      eq(datasetRows.agencyId, agencyId),
      eq(datasetRows.dataset, opts.dataset),
      ...(opts.from ? [sql`${datasetRows.recordDate} >= ${opts.from}`] : []),
      ...(opts.to ? [sql`${datasetRows.recordDate} <= ${opts.to}`] : []),
    ];
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(datasetRows)
        .where(and(...conditions))
        .orderBy(asc(datasetRows.recordDate), asc(datasetRows.rowIndex))
        .limit(opts.limit),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(datasetRows)
        .where(and(...conditions)),
    ]);
    return {
      rows: rows.map((r: typeof datasetRows.$inferSelect) => this.toDatasetRow(r)),
      total: totals[0]?.n ?? 0,
    };
  }

  // --- agent runs (§16.2) --------------------------------------------------

  private toAgentRun(r: typeof agentRuns.$inferSelect): AgentRunEntity {
    return {
      id: r.id,
      agencyId: r.agencyId,
      agentType: r.agentType as AgentRunEntity["agentType"],
      requestId: r.requestId,
      status: r.status as AgentRunEntity["status"],
      goal: r.goal,
      plan: r.plan ?? null,
      budgetLimits: r.budgetLimits ?? null,
      budgetSpend: r.budgetSpend ?? null,
      startedByUserId: r.startedByUserId,
      pausedByUserId: r.pausedByUserId,
      handoffNote: r.handoffNote,
      lastStepAt: r.lastStepAt,
      createdAt: r.createdAt,
    };
  }

  async createAgentRun(r: AgentRunEntity): Promise<AgentRunEntity> {
    await this.db.insert(agentRuns).values({
      id: r.id,
      agencyId: r.agencyId,
      agentType: r.agentType,
      requestId: r.requestId,
      status: r.status,
      goal: r.goal,
      plan: r.plan,
      budgetLimits: r.budgetLimits,
      budgetSpend: r.budgetSpend,
      startedByUserId: r.startedByUserId,
      handoffNote: r.handoffNote,
      lastStepAt: r.lastStepAt,
      createdAt: r.createdAt,
    });
    return r;
  }

  async getAgentRun(agencyId: string, id: string): Promise<AgentRunEntity | null> {
    const [row] = await this.db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.agencyId, agencyId), eq(agentRuns.id, id)))
      .limit(1);
    return row ? this.toAgentRun(row) : null;
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
  ): Promise<AgentRunEntity> {
    const [row] = await this.db
      .update(agentRuns)
      .set(patch)
      .where(and(eq(agentRuns.agencyId, agencyId), eq(agentRuns.id, id)))
      .returning();
    if (!row) throw new NotFoundError("AgentRun", id);
    return this.toAgentRun(row);
  }

  async listAgentRuns(agencyId: string): Promise<AgentRunEntity[]> {
    const rows = await this.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.agencyId, agencyId))
      .orderBy(desc(agentRuns.createdAt));
    return rows.map((r: typeof agentRuns.$inferSelect) => this.toAgentRun(r));
  }
}
