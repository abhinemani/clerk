/**
 * OCR-extract job (§6.5): the asynchronous recovery path for documents that
 * arrived with no text layer — scans, photos, image-only PDFs.
 *
 * Runs off the request path because OCR is slow (seconds per page); the
 * upload itself never waits on it. When text is recovered it lands via
 * repo.updateDocument, an ai_action event records the recovery, and the
 * exemption pass is re-enqueued so suggestions catch up with the new text.
 * With no engine configured (the self-contained default) this is a no-op —
 * the document honestly stays text-less.
 */
import { getOcrEngine, isOcrImageMime, type OcrEngine } from "@/adapters/ocr";
import { extractPdfImages } from "@/adapters/textExtract";
import { getBlobStore, type BlobStore } from "@/adapters/blobStore";
import type { DocumentEntity, Repository } from "@/services/repository";
import { getJobQueue, type JobPayloads } from "./queue";

/** Cap pages per document — a 500-page scan shouldn't monopolize the queue. */
const MAX_OCR_PAGES = 50;

/** Injectable for tests; the queue calls with the payload alone. */
export interface OcrJobDeps {
  repo: Repository;
  store: BlobStore;
  engine: OcrEngine;
  enqueueExemptionPass: (agencyId: string, requestId: string) => void;
}

export async function runOcrExtractJob(
  payload: JobPayloads["ocr_extract"],
  overrides?: Partial<OcrJobDeps>,
): Promise<void> {
  const engine = overrides?.engine ?? getOcrEngine();
  if (engine.kind === "disabled") return;

  const repo =
    overrides?.repo ?? (await (await import("@/db/createRepository")).getRepository());
  const docs: DocumentEntity[] = payload.documentId
    ? [await repo.getDocument(payload.agencyId, payload.documentId)].filter((d): d is DocumentEntity => d != null)
    : payload.requestId
      ? await repo.listRequestDocuments(payload.agencyId, payload.requestId)
      : [];

  const store = overrides?.store ?? getBlobStore();
  let recoveredAny = false;

  for (const doc of docs) {
    if (doc.extractedText != null) continue; // extraction already succeeded
    if (!doc.blobRef) continue; // metadata-only entry, nothing to read
    if (doc.externalSystemId?.startsWith("redacted:")) continue; // never burned artifacts

    const blob = await store.get(doc.blobRef);
    if (!blob) continue;
    const bytes = blob.bytes;

    // What do we feed the engine? A whole image file, or each embedded scan
    // image of a text-less PDF.
    let pages: { bytes: Buffer; mimeType: string }[] = [];
    if (isOcrImageMime(doc.mimeType)) {
      pages = [{ bytes, mimeType: doc.mimeType! }];
    } else if (
      bytes.subarray(0, 5).toString("latin1") === "%PDF-" ||
      doc.mimeType === "application/pdf"
    ) {
      pages = extractPdfImages(bytes);
    }
    if (pages.length === 0) continue;
    const skipped = Math.max(pages.length - MAX_OCR_PAGES, 0);
    pages = pages.slice(0, MAX_OCR_PAGES);

    const pageTexts: string[] = [];
    for (const page of pages) {
      const text = await engine.recognize(page.bytes, page.mimeType);
      if (text) pageTexts.push(text);
    }
    if (pageTexts.length === 0) continue; // engine saw nothing — stay honest

    const extractedText = pageTexts.join("\n\n");
    await repo.updateDocument(payload.agencyId, doc.id, {
      extractedText,
      pageCount: doc.pageCount ?? pages.length,
    });
    recoveredAny = true;

    if (payload.requestId) {
      await repo.appendEvent({
        id: crypto.randomUUID(),
        agencyId: payload.agencyId,
        requestId: payload.requestId,
        kind: "ai_action",
        actorUserId: null,
        summary: `OCR recovered text from ${doc.filename ?? doc.id} (${pageTexts.length} page(s)${skipped ? `, ${skipped} beyond the ${MAX_OCR_PAGES}-page cap left unscanned` : ""})`,
        payload: {
          pipeline: "ocr_extract",
          engine: engine.kind,
          documentId: doc.id,
          pagesRecognized: pageTexts.length,
          pagesSkipped: skipped,
        },
        createdAt: new Date(),
      });
    }
  }

  // Text just appeared on review-set documents — let the exemption pass and
  // classifier catch up (they skip docs they've already annotated).
  if (recoveredAny && payload.requestId) {
    const enqueue =
      overrides?.enqueueExemptionPass ??
      ((agencyId: string, requestId: string) =>
        getJobQueue().enqueue("exemption_pass", { agencyId, requestId }));
    enqueue(payload.agencyId, payload.requestId);
  }
}
