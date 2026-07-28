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
  agencies,
  deflections,
  departments,
  documents,
  publicIdCounters,
  requestEvents,
  requesters,
  requests,
  tasks,
} from "@/db/schema";
import { tenantWhere } from "@/db/tenant";
import {
  NotFoundError,
  type Agency,
  type DeflectionEntity,
  type Department,
  type DocumentEntity,
  type EventEntity,
  type RequestEntity,
  type Requester,
  type Repository,
  type TaskEntity,
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
  private toAgency(a: typeof agencies.$inferSelect): Agency {
    return { id: a.id, slug: a.slug, name: a.name, stateCode: a.stateCode, observedHolidays: a.observedHolidays ?? [] };
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
    await this.db.insert(requesters).values({ id: r.id, agencyId: r.agencyId, email: r.email, name: r.name, type: r.type });
    return r;
  }
  private toRequester(r: typeof requesters.$inferSelect): Requester {
    return { id: r.id, agencyId: r.agencyId, email: r.email, name: r.name, type: r.type };
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
    for (const k of ["status", "interpretedScope", "recordTypes", "complexityScore", "statutoryDueAt", "receivedAt"] as const) {
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
      createdAt: r.createdAt,
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
      createdAt: d.createdAt,
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
