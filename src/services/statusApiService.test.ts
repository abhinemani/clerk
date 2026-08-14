/**
 * Status API: the projection must be EXACTLY tracking-number-safe (nothing
 * about the requester, no raw text, milestones from status_change+extension
 * only), and webhook emits must be opt-in, fire-and-forget, and never throw.
 */
import { describe, expect, it } from "vitest";
import type { ServiceDeps } from "./deps";
import { InMemoryRepository, type Agency } from "./repository";
import {
  emitStatusWebhook,
  publicRequestStatus,
  type StatusWebhookPayload,
} from "./statusApiService";

const AGENCY: Agency = { id: "ag-1", slug: "riverton", name: "Riverton", stateCode: "CA", observedHolidays: [] };

function ctx() {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-08-13T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
  };
  return { repo, deps };
}

async function seedRequest(repo: InMemoryRepository) {
  const requester = await repo.createRequester({
    id: crypto.randomUUID(),
    agencyId: "ag-1",
    email: "jordan@example.com",
    name: "Jordan Banks",
    type: "media",
  });
  const request = await repo.createRequest({
    id: crypto.randomUUID(),
    agencyId: "ag-1",
    publicId: "PR-2026-00042",
    requesterId: requester.id,
    status: "in_progress",
    rawText: "My medical records and my address at 12 Elm St — inspection files",
    interpretedScope: "Inspection files for 12 Elm St",
    recordTypes: [],
    complexityScore: null,
    receivedAt: new Date("2026-08-01T00:00:00Z"),
    statutoryDueAt: new Date("2026-08-15T00:00:00Z"),
    closedAt: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
  });
  await repo.appendEvent({
    id: crypto.randomUUID(),
    agencyId: "ag-1",
    requestId: request.id,
    kind: "status_change",
    actorUserId: null,
    summary: "Request submitted as PR-2026-00042",
    payload: { to: "submitted" },
    createdAt: new Date("2026-08-01T00:00:00Z"),
  });
  await repo.appendEvent({
    id: crypto.randomUUID(),
    agencyId: "ag-1",
    requestId: request.id,
    kind: "note",
    actorUserId: "u-staff",
    summary: "Internal note: called Dana in Public Works about the Elm St file",
    createdAt: new Date("2026-08-02T00:00:00Z"),
  });
  return request;
}

describe("publicRequestStatus", () => {
  it("serves tracker-level facts and NOTHING about the requester or internals", async () => {
    const { repo } = ctx();
    await seedRequest(repo);
    const status = await publicRequestStatus(repo, {
      agencyId: "ag-1",
      agencySlug: "riverton",
      publicId: "pr-2026-00042", // case-insensitive lookup
    });

    expect(status).not.toBeNull();
    expect(status!.publicId).toBe("PR-2026-00042");
    expect(status!.status).toBe("in_progress");
    expect(status!.dueAt).toBe("2026-08-15T00:00:00.000Z");
    // Milestones: the status_change made it, the internal note did NOT.
    expect(status!.timeline).toHaveLength(1);

    const raw = JSON.stringify(status);
    expect(raw).not.toContain("Jordan"); // requester name
    expect(raw).not.toContain("jordan@example.com"); // requester email
    expect(raw).not.toContain("medical records"); // raw filing text
    expect(raw).not.toContain("Dana"); // staff names / internal notes
  });

  it("returns null for an unknown id and for another tenant's id", async () => {
    const { repo } = ctx();
    await seedRequest(repo);
    expect(
      await publicRequestStatus(repo, { agencyId: "ag-1", agencySlug: "riverton", publicId: "PR-2026-09999" }),
    ).toBeNull();
    await repo.createAgency({ id: "ag-2", slug: "bellmar", name: "Bellmar", stateCode: "CA", observedHolidays: [] });
    expect(
      await publicRequestStatus(repo, { agencyId: "ag-2", agencySlug: "bellmar", publicId: "PR-2026-00042" }),
    ).toBeNull();
  });
});

describe("emitStatusWebhook", () => {
  it("no-ops (no enqueue) when the agency has no webhook URL", async () => {
    const { deps } = ctx();
    const enqueued: StatusWebhookPayload[] = [];
    await emitStatusWebhook(
      deps,
      { agencyId: "ag-1", publicId: "PR-2026-00042", event: "status_changed", to: "fulfilled" },
      (_kind, payload) => enqueued.push(payload),
    );
    expect(enqueued).toEqual([]);
  });

  it("enqueues the ping when configured — and includes the deadline on extensions", async () => {
    const { repo, deps } = ctx();
    await repo.updateAgency("ag-1", {
      settings: { statusApi: { enabled: true, webhookUrl: "https://sub.example.com/hook" } },
    });
    const enqueued: StatusWebhookPayload[] = [];
    await emitStatusWebhook(
      deps,
      {
        agencyId: "ag-1",
        publicId: "PR-2026-00042",
        event: "deadline_extended",
        dueAt: new Date("2026-08-25T00:00:00Z"),
      },
      (_kind, payload) => enqueued.push(payload),
    );
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      publicId: "PR-2026-00042",
      event: "deadline_extended",
      dueAt: "2026-08-25T00:00:00.000Z",
    });
  });

  it("never throws — a webhook is telemetry, not part of the legal action", async () => {
    const { repo, deps } = ctx();
    await repo.updateAgency("ag-1", {
      settings: { statusApi: { enabled: true, webhookUrl: "https://sub.example.com/hook" } },
    });
    await expect(
      emitStatusWebhook(
        deps,
        { agencyId: "ag-1", publicId: "PR-2026-00042", event: "status_changed", to: "denied" },
        () => {
          throw new Error("queue exploded");
        },
      ),
    ).resolves.toBeUndefined();
  });
});
