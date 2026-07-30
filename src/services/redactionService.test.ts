/**
 * Tests for redaction finalize — invariant 1 (true redaction) and invariant 4
 * (named human) at the service layer, plus the release-side enforcement: a
 * release_redacted decision without a burned artifact cannot ship.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { BlobStore, StoredBlob } from "@/adapters/blobStore";
import { extractText } from "@/adapters/textExtract";
import { InMemoryRepository, type Agency } from "./repository";
import type { ServiceDeps } from "./deps";
import { finalizeRedaction, findRedactedArtifact, RedactionError } from "./redactionService";
import { releaseRequest, reviewDocument, ReleaseError } from "./releaseService";
import { submitRequest, transitionRequest } from "./requestService";
import { dispatchTask, startTask, submitTaskRecords } from "./taskService";

const AGENCY: Agency = {
  id: "ag-1",
  slug: "riverton",
  name: "City of Riverton",
  stateCode: "CA",
  observedHolidays: [],
};

class MemoryBlobStore implements BlobStore {
  readonly blobs = new Map<string, StoredBlob>();
  async put(key: string, bytes: Buffer, contentType: string) {
    this.blobs.set(key, { bytes, contentType });
    return key;
  }
  async get(key: string) {
    return this.blobs.get(key) ?? null;
  }
}

const DOC_LINES = [
  "RIVERTON POLICE DEPARTMENT - INCIDENT REPORT",
  "Reporting party: Jane A. Doe   SSN: 123-45-6789",
  "Narrative: vehicle damaged overnight at 400 Main St.",
];

async function setup() {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  const blobStore = new MemoryBlobStore();
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-07-29T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
    blobStore,
  };
  const request = await submitRequest(deps, {
    agencyId: "ag-1",
    rawText: "The June incident report for 400 Main St.",
    requester: { email: "req@example.com", name: "Req Uester" },
  });
  await transitionRequest(deps, { agencyId: "ag-1", requestId: request.id, to: "in_review", actorUserId: "staff-1" });
  await transitionRequest(deps, { agencyId: "ag-1", requestId: request.id, to: "in_progress", actorUserId: "staff-1" });
  const task = await dispatchTask(deps, { agencyId: "ag-1", requestId: request.id, scopeText: "incident report" });
  await startTask(deps, "ag-1", task.id);
  await submitTaskRecords(deps, {
    agencyId: "ag-1",
    taskId: task.id,
    uploads: [
      {
        name: "incident.txt",
        blobRef: "ag-1/incident.txt",
        byteSize: 100,
        mimeType: "text/plain",
        checksum: "abc",
        extractedText: DOC_LINES.join("\n"),
        pageCount: 1,
      },
    ],
  });
  const [doc] = await repo.listRequestDocuments("ag-1", request.id);
  return { repo, deps, blobStore, request, doc: doc! };
}

const SPANS = [
  { line: 1, startCol: 17, endCol: 28, reason: "Personal privacy" }, // Jane A. Doe
  { line: 1, startCol: 36, endCol: 47, reason: "Personal privacy — SSN" }, // the SSN
];

describe("finalizeRedaction", () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    s = await setup();
  });

  it("burns spans into a new artifact whose bytes contain no redacted content", async () => {
    const { artifact } = await finalizeRedaction(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      documentId: s.doc.id,
      actorUserId: "staff-1",
      spans: SPANS,
    });

    expect(artifact.filename).toBe("incident-redacted.pdf");
    expect(artifact.checksum).toBeTruthy();
    expect(artifact.classification).toBe("internal"); // never public by side effect

    // INVARIANT 1 — extract the stored artifact bytes; redacted values absent.
    const blob = await s.blobStore.get(artifact.blobRef!);
    expect(blob).not.toBeNull();
    const extracted = extractText(blob!.bytes, "application/pdf");
    expect(extracted).not.toBeNull();
    const text = extracted!.lines.join("\n");
    expect(text).not.toContain("Jane A. Doe");
    expect(text).not.toContain("123-45-6789");
    expect(blob!.bytes.toString("latin1")).not.toContain("123-45-6789");
    // Non-redacted content survives.
    expect(text).toContain("vehicle damaged overnight");

    // The decision was recorded under the actor's name.
    const reviews = await s.repo.listReviews("ag-1", s.request.id);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.decision).toBe("release_redacted");
    expect(reviews[0]!.decidedByUserId).toBe("staff-1");
    expect(reviews[0]!.exemptionLabel).toContain("Personal privacy");

    // Audit event carries the exemption log, never the values.
    const events = await s.repo.listEvents("ag-1", s.request.id);
    const evt = events.find((e) => e.summary.startsWith("Redactions finalized"));
    expect(evt?.actorUserId).toBe("staff-1");
    expect(JSON.stringify(evt?.payload)).not.toContain("123-45-6789");
  });

  it("requires a named human (invariant 4)", async () => {
    await expect(
      finalizeRedaction(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        documentId: s.doc.id,
        actorUserId: "",
        spans: SPANS,
      }),
    ).rejects.toThrow(RedactionError);
  });

  it("requires a reason on every span", async () => {
    await expect(
      finalizeRedaction(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        documentId: s.doc.id,
        actorUserId: "staff-1",
        spans: [{ line: 0, startCol: 0, endCol: 5, reason: " " }],
      }),
    ).rejects.toThrow(/exemption reason/);
  });

  it("refuses a document with no extractable text", async () => {
    const scan = await s.repo.createDocument({
      id: "doc-scan",
      agencyId: "ag-1",
      sourceId: null,
      externalSystemId: null,
      filename: "scan.pdf",
      classification: "internal",
      recordType: null,
      processingStatus: "ready",
      metadata: null,
      blobRef: "ag-1/scan.pdf",
      createdAt: new Date(),
    });
    await s.repo.linkRequestDocument("ag-1", s.request.id, scan.id);
    await expect(
      finalizeRedaction(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        documentId: scan.id,
        actorUserId: "staff-1",
        spans: SPANS,
      }),
    ).rejects.toThrow(/No extractable text/);
  });

  it("refuses documents outside the request's review set", async () => {
    const stray = await s.repo.createDocument({
      id: "doc-stray",
      agencyId: "ag-1",
      sourceId: null,
      externalSystemId: null,
      filename: "stray.txt",
      classification: "internal",
      recordType: null,
      processingStatus: "ready",
      metadata: null,
      extractedText: "text",
      createdAt: new Date(),
    });
    await expect(
      finalizeRedaction(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        documentId: stray.id,
        actorUserId: "staff-1",
        spans: SPANS,
      }),
    ).rejects.toThrow(/review set/);
  });

  it("refuses to burn when likely PII survives, and records an explicit override", async () => {
    // Redact only the name — the SSN survives the burn, so the §6.5 residual
    // pass must refuse.
    const nameOnly = [{ line: 1, startCol: 17, endCol: 28, reason: "Personal privacy" }];
    await expect(
      finalizeRedaction(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        documentId: s.doc.id,
        actorUserId: "staff-1",
        spans: nameOnly,
      }),
    ).rejects.toThrow(/Possible missed PII/);
    expect(await findRedactedArtifact(s.deps, "ag-1", s.doc.id)).toBeNull(); // nothing minted

    // The explicit override proceeds — and the audit event names the human.
    await finalizeRedaction(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      documentId: s.doc.id,
      actorUserId: "staff-1",
      spans: nameOnly,
      acceptResidualRisk: true,
    });
    const events = await s.repo.listEvents("ag-1", s.request.id);
    const evt = events.find((e) => e.summary.startsWith("Redactions finalized"));
    const residual = evt?.payload?.residualPii as { summary?: Record<string, number>; overriddenBy?: string };
    expect(residual?.overriddenBy).toBe("staff-1");
    expect(residual?.summary?.ssn).toBe(1);
  });

  it("re-finalizing mints a NEW artifact; the latest wins, priors persist", async () => {
    const first = await finalizeRedaction(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      documentId: s.doc.id,
      actorUserId: "staff-1",
      spans: SPANS,
    });
    const second = await finalizeRedaction(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      documentId: s.doc.id,
      actorUserId: "staff-2",
      spans: [...SPANS, { line: 2, startCol: 40, endCol: 51, reason: "Location privacy" }],
    });
    expect(second.artifact.id).not.toBe(first.artifact.id);
    const current = await findRedactedArtifact(s.deps, "ag-1", s.doc.id);
    expect(current?.id).toBe(second.artifact.id);
    // The first artifact document still exists — immutable history.
    expect(await s.repo.getDocument("ag-1", first.artifact.id)).not.toBeNull();
  });
});

describe("releaseRequest × redaction", () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    s = await setup();
  });

  it("refuses a FULL release of a document containing likely PII, override proceeds", async () => {
    await reviewDocument(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      documentId: s.doc.id,
      decision: "release", // in full — with the SSN still in the text
      actorUserId: "staff-1",
    });
    await expect(
      releaseRequest(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        actorUserId: "staff-1",
        visibility: "private",
      }),
    ).rejects.toThrow(/Possible PII in document/);

    const outcome = await releaseRequest(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      actorUserId: "staff-1",
      visibility: "private",
      acceptResidualRisk: true,
    });
    expect(outcome.released).toBe(1);
    const events = await s.repo.listEvents("ag-1", s.request.id);
    const approval = events.find((e) => e.summary.startsWith("Release approved"));
    const override = approval?.payload?.residualPiiOverride as { overriddenBy?: string };
    expect(override?.overriddenBy).toBe("staff-1");
  });

  it("refuses release_redacted with no burned artifact (the invariant-1 hole, closed)", async () => {
    await reviewDocument(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      documentId: s.doc.id,
      decision: "release_redacted",
      exemptionLabel: "Personal privacy",
      actorUserId: "staff-1",
    });
    await expect(
      releaseRequest(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        actorUserId: "staff-1",
        visibility: "private",
      }),
    ).rejects.toThrow(ReleaseError);
  });

  it("releases the burned artifact's bytes — never the original document", async () => {
    const { artifact } = await finalizeRedaction(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      documentId: s.doc.id,
      actorUserId: "staff-1",
      spans: SPANS,
    });
    const outcome = await releaseRequest(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      actorUserId: "staff-1",
      visibility: "private",
    });
    expect(outcome.released).toBe(1);
    const art = outcome.release.artifacts[0]!;
    expect(art.documentId).toBe(artifact.id); // the burned copy, not the source
    expect(art.blobRef).toBe(artifact.blobRef);
    expect(art.checksum).toBe(artifact.checksum);
    expect(art.filename).toBe("incident-redacted.pdf");
    // The original document id appears nowhere in the frozen artifact list.
    expect(outcome.release.artifacts.some((a) => a.documentId === s.doc.id)).toBe(false);
  });
});
