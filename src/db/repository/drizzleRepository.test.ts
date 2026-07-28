/**
 * The Drizzle repository against an embedded PGlite — proves migrations apply,
 * the adapter maps correctly, the services work over a real Postgres, and tenant
 * isolation holds at the database layer (§10). This is the same code path that
 * runs in production (Neon) and self-contained (PGlite on a volume).
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { agencies, users } from "@/db/schema";
import { DrizzleRepository } from "./drizzleRepository";
import { NotFoundError } from "@/services/repository";
import type { ServiceDeps } from "@/services/deps";
import { submitRequest, transitionRequest } from "@/services/requestService";
import { acceptTaskRecords, dispatchTask, startTask, submitTaskRecords } from "@/services/taskService";
import { getRequestActivity } from "@/services/activityService";

const AG1 = "11111111-1111-4111-8111-111111111111";
const AG2 = "22222222-2222-4222-8222-222222222222";
const USER1 = "33333333-3333-4333-8333-333333333333";

async function freshRepo(): Promise<DrizzleRepository> {
  const pg = new PGlite({ extensions: { vector } });
  const db = drizzle(pg, { schema });
  await migrate(db as never, { migrationsFolder: join(process.cwd(), "drizzle") });
  await db.insert(agencies).values([
    { id: AG1, slug: "riverton", name: "City of Riverton", stateCode: "CA" },
    { id: AG2, slug: "other", name: "Other City", stateCode: "TX" },
  ]);
  await db.insert(users).values({ id: USER1, agencyId: AG1, email: "clerk@riverton.gov", role: "coordinator" });
  return new DrizzleRepository(db);
}

function deps(repo: DrizzleRepository): ServiceDeps {
  return { repo, now: () => new Date(), genId: () => crypto.randomUUID(), genToken: () => crypto.randomUUID() };
}

describe("DrizzleRepository (embedded PGlite)", () => {
  let repo: DrizzleRepository;
  beforeAll(async () => {
    repo = await freshRepo();
  });

  it("persists a submitted request with a public id and audit event", async () => {
    const d = deps(repo);
    const r = await submitRequest(d, { agencyId: AG1, rawText: "All emails about zoning.", requester: { email: "a@b.com" } });
    expect(r.publicId).toMatch(/^PR-\d{4}-00001$/);

    const fetched = await repo.getRequest(AG1, r.id);
    expect(fetched?.rawText).toBe("All emails about zoning.");
    const events = await repo.listEvents(AG1, r.id);
    expect(events.some((e) => e.kind === "status_change")).toBe(true);
  });

  it("increments the public-id sequence via the counter table", async () => {
    const d = deps(repo);
    const a = await submitRequest(d, { agencyId: AG1, rawText: "one" });
    const b = await submitRequest(d, { agencyId: AG1, rawText: "two" });
    const na = Number(a.publicId.slice(-5));
    const nb = Number(b.publicId.slice(-5));
    expect(nb).toBe(na + 1);
  });

  it("enforces tenant isolation at the DB layer (§10)", async () => {
    const d = deps(repo);
    const r = await submitRequest(d, { agencyId: AG1, rawText: "secret" });
    expect(await repo.getRequest(AG2, r.id)).toBeNull();
    await expect(transitionRequest(d, { agencyId: AG2, requestId: r.id, to: "in_review" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("runs the full task loop and reflects it in the activity view", async () => {
    const d = deps(repo);
    const req = await submitRequest(d, { agencyId: AG1, rawText: "records for 400 Main St" });
    const task = await dispatchTask(d, { agencyId: AG1, requestId: req.id, departmentName: "Public Works", scopeText: "inspection reports" });
    await startTask(d, AG1, task.id);
    await submitTaskRecords(d, { agencyId: AG1, taskId: task.id, uploads: [{ name: "r.pdf", pages: 3 }] });
    await acceptTaskRecords(d, { agencyId: AG1, taskId: task.id, actorUserId: USER1 });

    const found = await repo.getTaskByToken(task.token);
    expect(found?.status).toBe("done");
    expect(found?.uploads).toHaveLength(1);

    const activity = await getRequestActivity(d, AG1, req.id);
    expect(activity.tasks).toHaveLength(1);
    expect(activity.taskRollup.byStatus.done).toBe(1);
    expect(activity.events.some((e) => e.kind === "approval")).toBe(true);
  });

  it("idempotently upserts an ingested document by external id", async () => {
    const first = await repo.upsertDocumentByExternalId({
      id: crypto.randomUUID(), agencyId: AG1, sourceId: null, externalSystemId: "po-100",
      filename: "po-100.pdf", classification: "public", recordType: "contract", processingStatus: "ready", metadata: {}, createdAt: new Date(),
    });
    expect(first.created).toBe(true);
    const second = await repo.upsertDocumentByExternalId({
      id: crypto.randomUUID(), agencyId: AG1, sourceId: null, externalSystemId: "po-100",
      filename: "po-100-rev.pdf", classification: "public", recordType: "contract", processingStatus: "ready", metadata: {}, createdAt: new Date(),
    });
    expect(second.created).toBe(false);
    expect(second.document.id).toBe(first.document.id);
  });
});
