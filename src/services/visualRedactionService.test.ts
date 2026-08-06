/**
 * Visual redaction finalize — invariant 1 (burned pixels are unrecoverable
 * from the artifact) and invariant 4 (named human) for image-backed
 * documents: scans, photos, PDFs with no text layer.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { BlobStore, StoredBlob } from "@/adapters/blobStore";
import { decodeImage, encodeJpeg, findUnburnedRegions, type RasterImage } from "@/adapters/imageCodec";
import { extractPdfImages, extractText } from "@/adapters/textExtract";
import { imagesToPdf } from "@/domain/imagePdf";
import { InMemoryRepository, type Agency } from "./repository";
import type { ServiceDeps } from "./deps";
import { RedactionError, findRedactedArtifact } from "./redactionService";
import { documentPageImages, finalizeVisualRedaction } from "./visualRedactionService";
import { submitRequest, transitionRequest } from "./requestService";
import { dispatchTask, startTask, submitTaskRecords } from "./taskService";

const AGENCY: Agency = { id: "ag-1", slug: "riverton", name: "City of Riverton", stateCode: "CA", observedHolidays: [] };

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

function solid(width: number, height: number, rgb: [number, number, number]): RasterImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  return { width, height, data };
}

/** Stand-in for a scanned page: a white JPEG (imagine the SSN at top-left). */
const SCAN_JPEG = encodeJpeg(solid(200, 260, [250, 250, 250]));
const BOX = { page: 0, x: 0.05, y: 0.05, w: 0.6, h: 0.15, reason: "Personnel privacy (Gov 6254(c))" };

async function setup(upload: { name: string; bytes: Buffer; mimeType: string }) {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  const blobStore = new MemoryBlobStore();
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-08-06T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
    blobStore,
  };
  const request = await submitRequest(deps, { agencyId: "ag-1", rawText: "The incident scan." });
  await transitionRequest(deps, { agencyId: "ag-1", requestId: request.id, to: "in_review", actorUserId: "staff-1" });
  await transitionRequest(deps, { agencyId: "ag-1", requestId: request.id, to: "in_progress", actorUserId: "staff-1" });
  const task = await dispatchTask(deps, { agencyId: "ag-1", requestId: request.id, scopeText: "scan" });
  await startTask(deps, "ag-1", task.id);
  const blobRef = await blobStore.put(`ag-1/${upload.name}`, upload.bytes, upload.mimeType);
  await submitTaskRecords(deps, {
    agencyId: "ag-1",
    taskId: task.id,
    uploads: [{ name: upload.name, blobRef, byteSize: upload.bytes.length, mimeType: upload.mimeType, checksum: "cs" }],
  });
  const [doc] = await repo.listRequestDocuments("ag-1", request.id);
  return { repo, deps, blobStore, request, doc: doc! };
}

describe("documentPageImages", () => {
  it("an image upload is one page; a scan PDF contributes its embedded images; text is none", () => {
    expect(documentPageImages(SCAN_JPEG, "image/jpeg")).toHaveLength(1);
    const scanPdf = imagesToPdf([
      { jpeg: SCAN_JPEG, width: 200, height: 260 },
      { jpeg: SCAN_JPEG, width: 200, height: 260 },
    ]);
    expect(documentPageImages(scanPdf, "application/pdf")).toHaveLength(2);
    expect(documentPageImages(Buffer.from("plain text"), "text/plain")).toHaveLength(0);
  });
});

describe("finalizeVisualRedaction", () => {
  it("burns boxes, mints a leak-free image PDF, and records the decision under the actor", async () => {
    const s = await setup({ name: "incident-scan.jpg", bytes: SCAN_JPEG, mimeType: "image/jpeg" });
    const { artifact, redactionCount, pageCount } = await finalizeVisualRedaction(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      documentId: s.doc.id,
      actorUserId: "staff-1",
      boxes: [BOX],
    });

    expect(redactionCount).toBe(1);
    expect(pageCount).toBe(1);
    expect(artifact.externalSystemId).toBe(`redacted:${s.doc.id}`);
    expect(artifact.classification).toBe("internal"); // never public by side effect
    expect(artifact.extractedText ?? null).toBeNull(); // OCR text never rides along
    expect(artifact.mimeType).toBe("application/pdf");

    // ADVERSARY PATH (invariant 1): open the released artifact, pull its
    // image back out, and look under the bar. Verifiably black.
    const released = (await s.blobStore.get(artifact.blobRef!))!;
    const recovered = extractPdfImages(released.bytes);
    expect(recovered).toHaveLength(1);
    expect(findUnburnedRegions(recovered[0]!.bytes, [BOX])).toEqual([]);
    // The artifact contains none of the original scan's bytes...
    expect(released.bytes.indexOf(SCAN_JPEG)).toBe(-1);
    // ...and no text layer at all.
    const text = extractText(released.bytes, "application/pdf");
    expect(text === null || text.lines.join("").trim() === "").toBe(true);
    // Unburned area survives — the release is still a usable record.
    const raster = decodeImage(recovered[0]!.bytes)!;
    const bottomRight = ((raster.height - 5) * raster.width + raster.width - 5) * 4;
    expect(raster.data[bottomRight]).toBeGreaterThan(200);

    // The decision + audit trail, exactly like the text path.
    const reviews = await s.repo.listReviews("ag-1", s.request.id);
    expect(reviews[0]).toMatchObject({ decision: "release_redacted", decidedByUserId: "staff-1" });
    const events = await s.repo.listEvents("ag-1", s.request.id);
    const approval = events.find((e) => e.kind === "approval");
    expect(approval?.summary).toContain("Visual redactions finalized");
    expect(approval?.actorUserId).toBe("staff-1");
    // findRedactedArtifact resolves it — releaseService ships it unchanged.
    expect((await findRedactedArtifact(s.deps, "ag-1", s.doc.id))?.id).toBe(artifact.id);
  });

  it("redacts a multi-page scan PDF, burning only the boxed page", async () => {
    const scanPdf = imagesToPdf([
      { jpeg: SCAN_JPEG, width: 200, height: 260 },
      { jpeg: SCAN_JPEG, width: 200, height: 260 },
    ]);
    const s = await setup({ name: "report.pdf", bytes: scanPdf, mimeType: "application/pdf" });
    const { artifact } = await finalizeVisualRedaction(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      documentId: s.doc.id,
      actorUserId: "staff-1",
      boxes: [{ ...BOX, page: 1 }],
    });
    expect(artifact.pageCount).toBe(2);
    const released = (await s.blobStore.get(artifact.blobRef!))!;
    const recovered = extractPdfImages(released.bytes);
    expect(recovered).toHaveLength(2);
    expect(findUnburnedRegions(recovered[1]!.bytes, [BOX])).toEqual([]); // page 2 burned
    expect(findUnburnedRegions(recovered[0]!.bytes, [BOX])).toEqual([0]); // page 1 untouched
  });

  it("refuses: missing reason, out-of-page box, page out of range, no boxes, anonymous actor", async () => {
    const s = await setup({ name: "scan.jpg", bytes: SCAN_JPEG, mimeType: "image/jpeg" });
    const base = { agencyId: "ag-1", requestId: s.request.id, documentId: s.doc.id, actorUserId: "staff-1" };
    await expect(finalizeVisualRedaction(s.deps, { ...base, boxes: [{ ...BOX, reason: " " }] })).rejects.toThrow(/reason/);
    await expect(finalizeVisualRedaction(s.deps, { ...base, boxes: [{ ...BOX, x: 0.8, w: 0.5 }] })).rejects.toThrow(/outside the page/);
    await expect(finalizeVisualRedaction(s.deps, { ...base, boxes: [{ ...BOX, page: 3 }] })).rejects.toThrow(/has 1 page/);
    await expect(finalizeVisualRedaction(s.deps, { ...base, boxes: [] })).rejects.toThrow(/No redactions/);
    await expect(
      finalizeVisualRedaction(s.deps, { ...base, actorUserId: "", boxes: [BOX] }),
    ).rejects.toThrow(/named user/);
    expect(await findRedactedArtifact(s.deps, "ag-1", s.doc.id)).toBeNull(); // nothing minted
  });

  it("refuses a document with no page images and points at the text studio", async () => {
    const s = await setup({ name: "notes.txt", bytes: Buffer.from("plain text"), mimeType: "text/plain" });
    await expect(
      finalizeVisualRedaction(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        documentId: s.doc.id,
        actorUserId: "staff-1",
        boxes: [BOX],
      }),
    ).rejects.toThrow(/text redaction studio/);
  });

  it("refuses a document outside the request's review set", async () => {
    const s = await setup({ name: "scan.jpg", bytes: SCAN_JPEG, mimeType: "image/jpeg" });
    const stray = await s.repo.createDocument({
      id: "stray-doc",
      agencyId: "ag-1",
      sourceId: null,
      externalSystemId: null,
      filename: "stray.jpg",
      classification: "internal",
      recordType: null,
      processingStatus: "ready",
      metadata: {},
      createdAt: new Date(),
    });
    await expect(
      finalizeVisualRedaction(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        documentId: stray.id,
        actorUserId: "staff-1",
        boxes: [BOX],
      }),
    ).rejects.toThrow(/review set/);
  });

  it("re-finalizing mints a NEW artifact version; the prior stays immutable", async () => {
    const s = await setup({ name: "scan.jpg", bytes: SCAN_JPEG, mimeType: "image/jpeg" });
    const base = { agencyId: "ag-1", requestId: s.request.id, documentId: s.doc.id, actorUserId: "staff-1" };
    const first = await finalizeVisualRedaction(s.deps, { ...base, boxes: [BOX] });
    const second = await finalizeVisualRedaction(s.deps, {
      ...base,
      boxes: [BOX, { page: 0, x: 0.1, y: 0.5, w: 0.3, h: 0.2, reason: "Medical privacy" }],
    });
    expect(second.artifact.id).not.toBe(first.artifact.id);
    expect((await findRedactedArtifact(s.deps, "ag-1", s.doc.id))?.id).toBe(second.artifact.id);
    expect(await s.repo.getDocument("ag-1", first.artifact.id)).not.toBeNull(); // prior version intact
  });
});

beforeEach(() => {
  // Silence unused-import lint in case beforeEach hooks are added later.
});
