import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "./repository";
import type { ServiceDeps } from "./deps";
import { CollectingNotifier } from "./notifications";
import { submitRequest, transitionRequest } from "./requestService";
import { dispatchTask, startTask, submitTaskRecords } from "./taskService";
import { ReleaseError, releaseRequest, reviewDocument } from "./releaseService";

const AG = "ag-1";
const APPROVER = "user-approver";

function makeDeps(): ServiceDeps & { notifier: CollectingNotifier } {
  let n = 0;
  const repo = new InMemoryRepository().seedAgency({
    id: AG,
    slug: "riverton",
    name: "Riverton",
    stateCode: "CA",
    observedHolidays: [],
  });
  return {
    repo,
    now: () => new Date("2026-07-28T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
    notifier: new CollectingNotifier(),
  };
}

/** File → dispatch → responder submits two records. Returns request + doc ids. */
async function fulfilledSetup(deps: ServiceDeps) {
  const request = await submitRequest(deps, {
    agencyId: AG,
    rawText: "janitorial contract",
    requester: { email: "wei@example.com", name: "Wei" },
  });
  await transitionRequest(deps, { agencyId: AG, requestId: request.id, to: "in_review" });
  await transitionRequest(deps, { agencyId: AG, requestId: request.id, to: "in_progress" });
  const task = await dispatchTask(deps, {
    agencyId: AG,
    requestId: request.id,
    departmentId: undefined,
    departmentName: "City Clerk",
    departmentEmail: "clerk@r.gov",
    scopeText: "pull the contract",
    dueAt: new Date("2026-07-30T12:00:00Z"),
  });
  await startTask(deps, AG, task.id);
  await submitTaskRecords(deps, {
    agencyId: AG,
    taskId: task.id,
    uploads: [
      { name: "contract.pdf", pages: 11, blobRef: "ag-1/contract", byteSize: 42, mimeType: "application/pdf", checksum: "aa".repeat(32) },
      { name: "amendment.pdf", pages: 2 },
    ],
  });
  const docs = await deps.repo.listRequestDocuments(AG, request.id);
  return { request, docs };
}

describe("review & release", () => {
  it("submitted uploads become internal documents linked to the request", async () => {
    const deps = makeDeps();
    const { docs } = await fulfilledSetup(deps);
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.classification === "internal")).toBe(true);

    // Blob-backed upload carries its storage key + integrity metadata.
    const stored = docs.find((d) => d.filename === "contract.pdf")!;
    expect(stored.blobRef).toBe("ag-1/contract");
    expect(stored.byteSize).toBe(42);
    expect(stored.checksum).toBe("aa".repeat(32));
  });

  it("released artifacts reuse the stored checksum and resolve back to their release", async () => {
    const deps = makeDeps();
    const { request, docs } = await fulfilledSetup(deps);
    for (const d of docs) {
      await reviewDocument(deps, { agencyId: AG, requestId: request.id, documentId: d.id, decision: "release", actorUserId: APPROVER });
    }
    const outcome = await releaseRequest(deps, { agencyId: AG, requestId: request.id, actorUserId: APPROVER, visibility: "private" });

    const stored = docs.find((d) => d.filename === "contract.pdf")!;
    const artifact = outcome.release.artifacts.find((a) => a.documentId === stored.id)!;
    expect(artifact.checksum).toBe("aa".repeat(32)); // real bytes → real checksum
    expect(artifact.blobRef).toBe("ag-1/contract");

    // The download endpoint's entitlement lookup: document → its release.
    const found = await deps.repo.findReleaseContainingDocument(AG, stored.id);
    expect(found?.id).toBe(outcome.release.id);
    expect(await deps.repo.findReleaseContainingDocument(AG, "no-such-doc")).toBeNull();
  });

  it("refuses to release with undecided documents, then closes fulfilled when all released", async () => {
    const deps = makeDeps();
    const { request, docs } = await fulfilledSetup(deps);

    await expect(
      releaseRequest(deps, { agencyId: AG, requestId: request.id, actorUserId: APPROVER, visibility: "private" }),
    ).rejects.toBeInstanceOf(ReleaseError);

    for (const d of docs) {
      await reviewDocument(deps, {
        agencyId: AG,
        requestId: request.id,
        documentId: d.id,
        decision: "release",
        actorUserId: APPROVER,
      });
    }
    const outcome = await releaseRequest(deps, {
      agencyId: AG,
      requestId: request.id,
      actorUserId: APPROVER,
      visibility: "private",
    });

    expect(outcome.released).toBe(2);
    expect(outcome.request.status).toBe("fulfilled");
    expect(outcome.request.closedAt).not.toBeNull(); // the clock stopped
    expect(outcome.release.approvedByUserId).toBe(APPROVER); // named human, always

    // The requester was told, and the letter went through the notifier.
    const letter = deps.notifier.sent.find((m) => m.kind === "requester_update");
    expect(letter?.to).toBe("wei@example.com");

    // Private release → nothing entered the public archive.
    expect(await deps.repo.listPublicDocuments(AG)).toHaveLength(0);
  });

  it("withholding needs a reason, produces partially_fulfilled, and public release feeds the archive", async () => {
    const deps = makeDeps();
    const { request, docs } = await fulfilledSetup(deps);

    // No exemption reason → refused.
    await expect(
      reviewDocument(deps, {
        agencyId: AG,
        requestId: request.id,
        documentId: docs[0]!.id,
        decision: "withhold",
        actorUserId: APPROVER,
      }),
    ).rejects.toBeInstanceOf(ReleaseError);

    await reviewDocument(deps, {
      agencyId: AG,
      requestId: request.id,
      documentId: docs[0]!.id,
      decision: "withhold",
      exemptionLabel: "Personnel privacy",
      actorUserId: APPROVER,
    });
    await reviewDocument(deps, {
      agencyId: AG,
      requestId: request.id,
      documentId: docs[1]!.id,
      decision: "release_redacted",
      exemptionLabel: "PII",
      actorUserId: APPROVER,
    });

    const outcome = await releaseRequest(deps, {
      agencyId: AG,
      requestId: request.id,
      actorUserId: APPROVER,
      visibility: "public",
      archiveTitle: "Janitorial Services Contract",
    });

    expect(outcome.request.status).toBe("partially_fulfilled");
    expect(outcome.released).toBe(1);
    expect(outcome.withheld).toBe(1);
    // Redacted artifact is renamed so the original is never what ships.
    expect(outcome.release.artifacts[0]!.filename).toMatch(/-redacted\.pdf$/);
    // The withheld exemption appears in the letter (defensibility).
    expect(outcome.release.responseLetter).toContain("Personnel privacy");

    // Public release → exactly one archive entry with searchable metadata.
    const archive = await deps.repo.listPublicDocuments(AG);
    expect(archive).toHaveLength(1);
    expect((archive[0]!.metadata as { title?: string }).title).toBe("Janitorial Services Contract");
  });

  it("refuses an all-withheld 'release' — that's a denial, not a release", async () => {
    const deps = makeDeps();
    const { request, docs } = await fulfilledSetup(deps);
    for (const d of docs) {
      await reviewDocument(deps, {
        agencyId: AG,
        requestId: request.id,
        documentId: d.id,
        decision: "withhold",
        exemptionLabel: "Ongoing investigation",
        actorUserId: APPROVER,
      });
    }
    await expect(
      releaseRequest(deps, { agencyId: AG, requestId: request.id, actorUserId: APPROVER, visibility: "private" }),
    ).rejects.toBeInstanceOf(ReleaseError);
  });
});
