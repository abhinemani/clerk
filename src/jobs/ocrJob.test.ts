/**
 * OCR-extract job tests (§6.5): text-less scans gain a text rendition when an
 * engine is configured; nothing happens — honestly — when it isn't.
 */
import { describe, expect, it } from "vitest";
import type { BlobStore } from "@/adapters/blobStore";
import type { OcrEngine } from "@/adapters/ocr";
import { InMemoryRepository, type DocumentEntity } from "@/services/repository";
import { runOcrExtractJob } from "./ocrJob";

const AGENCY = "ag-1";
const REQUEST = "req-1";

class FakeBlobStore implements BlobStore {
  private blobs = new Map<string, { bytes: Buffer; contentType: string }>();
  async put(key: string, bytes: Buffer, contentType: string) {
    this.blobs.set(key, { bytes, contentType });
    return key;
  }
  async get(key: string) {
    return this.blobs.get(key) ?? null;
  }
}

/** Engine that "reads" the bytes back as text; returns null for blank pages. */
const fakeEngine: OcrEngine = {
  kind: "http",
  async recognize(image: Buffer) {
    const s = image.toString("utf8");
    return s.includes("blank") ? null : `OCR<${s}>`;
  },
};

/** Minimal PDF whose only content is DCTDecode (JPEG) image streams. */
function scannedPdf(pages: Buffer[]): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n", "latin1")];
  pages.forEach((img, i) => {
    parts.push(
      Buffer.from(
        `${i + 2} 0 obj << /Subtype /Image /Filter /DCTDecode /Length ${img.length} >> stream\n`,
        "latin1",
      ),
      img,
      Buffer.from("\nendstream endobj\n", "latin1"),
    );
  });
  parts.push(Buffer.from("%%EOF", "latin1"));
  return Buffer.concat(parts);
}

function doc(overrides: Partial<DocumentEntity>): DocumentEntity {
  return {
    id: "doc-1",
    agencyId: AGENCY,
    sourceId: null,
    externalSystemId: null,
    filename: "scan.png",
    classification: "internal",
    recordType: null,
    processingStatus: "ready",
    metadata: null,
    createdAt: new Date("2026-07-29T12:00:00Z"),
    ...overrides,
  };
}

async function setup(documents: DocumentEntity[], blobs: [string, Buffer, string][]) {
  const repo = new InMemoryRepository();
  const store = new FakeBlobStore();
  for (const [key, bytes, type] of blobs) await store.put(key, bytes, type);
  for (const d of documents) {
    await repo.createDocument(d);
    await repo.linkRequestDocument(AGENCY, REQUEST, d.id);
  }
  const enqueued: string[] = [];
  const deps = {
    repo,
    store,
    engine: fakeEngine,
    enqueueExemptionPass: (_a: string, r: string) => enqueued.push(r),
  };
  return { repo, store, deps, enqueued };
}

describe("runOcrExtractJob", () => {
  it("is a no-op when OCR is disabled (the self-contained default)", async () => {
    const { repo, deps } = await setup(
      [doc({ blobRef: "b1", mimeType: "image/png" })],
      [["b1", Buffer.from("a scan"), "image/png"]],
    );
    await runOcrExtractJob(
      { agencyId: AGENCY, requestId: REQUEST },
      { ...deps, engine: { kind: "disabled", recognize: async () => null } },
    );
    expect((await repo.getDocument(AGENCY, "doc-1"))?.extractedText).toBeUndefined();
  });

  it("recovers text from an image document, logs it, and re-enqueues the exemption pass", async () => {
    const { repo, deps, enqueued } = await setup(
      [doc({ blobRef: "b1", mimeType: "image/png" })],
      [["b1", Buffer.from("INCIDENT REPORT page"), "image/png"]],
    );
    await runOcrExtractJob({ agencyId: AGENCY, requestId: REQUEST }, deps);

    const updated = await repo.getDocument(AGENCY, "doc-1");
    expect(updated?.extractedText).toBe("OCR<INCIDENT REPORT page>");
    expect(updated?.pageCount).toBe(1);

    const events = await repo.listEvents(AGENCY, REQUEST);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("ai_action");
    expect(events[0]!.summary).toContain("OCR recovered text");
    expect(enqueued).toEqual([REQUEST]);
  });

  it("feeds each embedded image of a scanned PDF and counts them as pages", async () => {
    const pdf = scannedPdf([Buffer.from("page one"), Buffer.from("page two")]);
    const { repo, deps } = await setup(
      [doc({ blobRef: "b1", mimeType: "application/pdf", filename: "scan.pdf" })],
      [["b1", pdf, "application/pdf"]],
    );
    await runOcrExtractJob({ agencyId: AGENCY, requestId: REQUEST }, deps);

    const updated = await repo.getDocument(AGENCY, "doc-1");
    expect(updated?.extractedText).toBe("OCR<page one>\n\nOCR<page two>");
    expect(updated?.pageCount).toBe(2);
  });

  it("skips documents that already have text, burned artifacts, and metadata-only entries", async () => {
    const { repo, deps, enqueued } = await setup(
      [
        doc({ id: "has-text", blobRef: "b1", mimeType: "image/png", extractedText: "already" }),
        doc({ id: "burned", blobRef: "b1", mimeType: "image/png", externalSystemId: "redacted:xyz" }),
        doc({ id: "no-bytes", blobRef: null, mimeType: "image/png" }),
      ],
      [["b1", Buffer.from("scan"), "image/png"]],
    );
    await runOcrExtractJob({ agencyId: AGENCY, requestId: REQUEST }, deps);

    expect((await repo.getDocument(AGENCY, "has-text"))?.extractedText).toBe("already");
    expect((await repo.getDocument(AGENCY, "burned"))?.extractedText).toBeUndefined();
    expect((await repo.getDocument(AGENCY, "no-bytes"))?.extractedText).toBeUndefined();
    expect(await repo.listEvents(AGENCY, REQUEST)).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it("stays honest when the engine sees nothing — no text, no event, no enqueue", async () => {
    const { repo, deps, enqueued } = await setup(
      [doc({ blobRef: "b1", mimeType: "image/png" })],
      [["b1", Buffer.from("blank page"), "image/png"]],
    );
    await runOcrExtractJob({ agencyId: AGENCY, requestId: REQUEST }, deps);

    expect((await repo.getDocument(AGENCY, "doc-1"))?.extractedText).toBeUndefined();
    expect(await repo.listEvents(AGENCY, REQUEST)).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it("targets a single document when documentId is given", async () => {
    const { repo, deps } = await setup(
      [
        doc({ id: "target", blobRef: "b1", mimeType: "image/png" }),
        doc({ id: "other", blobRef: "b1", mimeType: "image/png" }),
      ],
      [["b1", Buffer.from("scan"), "image/png"]],
    );
    await runOcrExtractJob({ agencyId: AGENCY, documentId: "target" }, deps);

    expect((await repo.getDocument(AGENCY, "target"))?.extractedText).toBe("OCR<scan>");
    expect((await repo.getDocument(AGENCY, "other"))?.extractedText).toBeUndefined();
  });
});
