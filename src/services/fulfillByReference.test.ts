/**
 * Fulfill-by-reference tests: closing a request by citing an already-public
 * record. The two load-bearing rules: only a PUBLIC document can answer (no
 * side door around review), and it is always a named human's act.
 */
import { describe, expect, it } from "vitest";
import { InvalidTransitionError } from "@/domain/requestLifecycle";
import type { Notifier, OutboundMessage } from "./notifications";
import { InMemoryRepository, type Agency, type UserEntity } from "./repository";
import type { ServiceDeps } from "./deps";
import { fulfillByReference, ReleaseError } from "./releaseService";
import { submitRequest } from "./requestService";

const AGENCY: Agency = { id: "ag-1", slug: "riverton", name: "City of Riverton", stateCode: "CA", observedHolidays: [] };
const DANA: UserEntity = { id: "u-dana", agencyId: "ag-1", email: "dana@riverton.gov", name: "Dana", role: "admin", passwordHash: null };

class CapturingNotifier implements Notifier {
  sent: OutboundMessage[] = [];
  async send(msg: OutboundMessage) {
    this.sent.push(msg);
    return { id: `n-${this.sent.length}`, channel: "outbox", to: msg.to, deliveredAt: new Date() };
  }
}

async function ctx() {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  await repo.createUser(DANA);
  const notifier = new CapturingNotifier();
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-08-04T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
    notifier,
    baseUrl: "https://records.example",
  };
  await repo.createDocument({
    id: "doc-pub",
    agencyId: "ag-1",
    sourceId: null,
    externalSystemId: null,
    filename: "budget.pdf",
    classification: "public",
    recordType: null,
    processingStatus: "ready",
    metadata: { title: "Adopted FY2025 Budget" },
    createdAt: new Date(),
  });
  await repo.createDocument({
    id: "doc-internal",
    agencyId: "ag-1",
    sourceId: null,
    externalSystemId: null,
    filename: "draft.pdf",
    classification: "internal",
    recordType: null,
    processingStatus: "ready",
    metadata: null,
    createdAt: new Date(),
  });
  return { repo, deps, notifier };
}

describe("fulfillByReference", () => {
  it("closes as fulfilled with the permalink in the letter, audited and ROI-logged", async () => {
    const { repo, deps, notifier } = await ctx();
    const r = await submitRequest(deps, {
      agencyId: "ag-1",
      rawText: "The adopted FY2025 budget.",
      requester: { email: "wei@example.com", name: "Wei Chen" },
    });
    notifier.sent = [];

    const out = await fulfillByReference(deps, {
      agencyId: "ag-1",
      requestId: r.id,
      actorUserId: "u-dana",
      documentId: "doc-pub",
    });

    expect(out.request.status).toBe("fulfilled");
    expect(out.request.closedAt).not.toBeNull();
    expect(out.letter).toContain("Adopted FY2025 Budget");
    expect(out.letter).toContain("https://records.example/riverton/archive/doc-pub");

    // Delivered to the requester with the same content.
    const mail = notifier.sent.find((m) => m.to === "wei@example.com");
    expect(mail?.body).toContain("/riverton/archive/doc-pub");

    // Audit: named human, by-reference marker.
    const events = await repo.listEvents("ag-1", r.id);
    const change = events.find((e) => e.kind === "status_change" && e.payload?.to === "fulfilled");
    expect(change?.actorUserId).toBe("u-dana");
    expect(change?.payload?.byReference).toBe(true);

    // The ROI number.
    const deflections = await repo.listDeflections("ag-1");
    expect(deflections.some((d) => d.kind === "answered_by_link" && d.documentId === "doc-pub")).toBe(true);
  });

  it("refuses a non-public document — no side door around review", async () => {
    const { deps } = await ctx();
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "Draft budget memos." });
    await expect(
      fulfillByReference(deps, { agencyId: "ag-1", requestId: r.id, actorUserId: "u-dana", documentId: "doc-internal" }),
    ).rejects.toThrow(ReleaseError);
  });

  it("requires a named approver and a still-open request", async () => {
    const { deps } = await ctx();
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "The budget." });
    await expect(
      fulfillByReference(deps, { agencyId: "ag-1", requestId: r.id, actorUserId: "", documentId: "doc-pub" }),
    ).rejects.toThrow(ReleaseError);

    await fulfillByReference(deps, { agencyId: "ag-1", requestId: r.id, actorUserId: "u-dana", documentId: "doc-pub" });
    await expect(
      fulfillByReference(deps, { agencyId: "ag-1", requestId: r.id, actorUserId: "u-dana", documentId: "doc-pub" }),
    ).rejects.toThrow(InvalidTransitionError);
  });
});
