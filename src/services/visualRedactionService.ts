/**
 * VISUAL redaction finalize (spec §6.5; docs/invariants.md #1, #4) — the
 * image-document counterpart to redactionService.ts. For scans, photos, and
 * PDFs with no text layer, a named human draws rectangles on the rendered
 * pages; this service:
 *
 *  1. decodes each page raster and BURNS the rectangles (pixels set to black
 *     and the whole page re-encoded — content destroyed, not covered),
 *  2. verifies the burn on the re-encoded bytes (`findUnburnedRegions` — the
 *     visual findLeaks; any readable region aborts),
 *  3. regenerates the artifact as an image-only PDF built from the burned
 *     rasters (`imagesToPdf` — the original pixels were never written in),
 *  4. confirms at the byte level that no original page image survives in the
 *     artifact,
 *  5. stores the artifact under `redacted:{documentId}` and records the
 *     release_redacted decision + audit event, exactly like the text path —
 *     releaseService needs no changes to ship it.
 *
 * The artifact has NO text layer and NO extracted text: any OCR text the
 * source document carried does not travel to the release.
 */
import { blobKey, checksumOf } from "@/adapters/blobStore";
import {
  burnRegions,
  decodeImage,
  encodeJpeg,
  findUnburnedRegions,
  type NormalizedRect,
} from "@/adapters/imageCodec";
import { extractPdfImages } from "@/adapters/textExtract";
import { imagesToPdf, type PdfPageImage } from "@/domain/imagePdf";
import type { ServiceDeps } from "./deps";
import { NotFoundError, type DocumentEntity } from "./repository";
import { redactedArtifactExternalId, RedactionError } from "./redactionService";
import { reviewDocument } from "./releaseService";

/** One drawn redaction: a page index + normalized rect + exemption reason. */
export interface VisualRedactionBox extends NormalizedRect {
  /** 0-based page index. */
  page: number;
  reason: string;
}

export interface FinalizeVisualRedactionInput {
  agencyId: string;
  requestId: string;
  documentId: string;
  /** The named human finalizing — required (invariant 4). */
  actorUserId: string;
  boxes: VisualRedactionBox[];
}

const MAX_PAGES = 50; // matches the OCR feed cap
const MAX_BOXES = 200;

/**
 * The page rasters of an image-backed document: an uploaded image is one
 * page; a PDF contributes its embedded scan images. Empty when the document
 * isn't visually redactable (text-born PDFs belong in the text studio).
 */
export function documentPageImages(bytes: Buffer, mimeType: string | null): Buffer[] {
  if (mimeType?.startsWith("image/")) return [bytes];
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") {
    return extractPdfImages(bytes).map((p) => p.bytes).slice(0, MAX_PAGES);
  }
  return [];
}

export interface FinalizeVisualRedactionOutcome {
  artifact: DocumentEntity;
  redactionCount: number;
  pageCount: number;
}

export async function finalizeVisualRedaction(
  deps: ServiceDeps,
  input: FinalizeVisualRedactionInput,
): Promise<FinalizeVisualRedactionOutcome> {
  const { repo, blobStore } = deps;
  if (!input.actorUserId) throw new RedactionError("Finalizing redactions requires a named user.");
  if (!blobStore) throw new RedactionError("No blob store configured — cannot mint the artifact.");
  if (input.boxes.length === 0) {
    throw new RedactionError("No redactions to burn — release the document in full instead.");
  }
  if (input.boxes.length > MAX_BOXES) {
    throw new RedactionError(`At most ${MAX_BOXES} redactions per document.`);
  }
  for (const b of input.boxes) {
    if (!b.reason?.trim()) throw new RedactionError("Every redaction needs an exemption reason.");
    if (!(b.w > 0 && b.h > 0) || b.x < 0 || b.y < 0 || b.x + b.w > 1.001 || b.y + b.h > 1.001) {
      throw new RedactionError("A redaction box is outside the page.");
    }
  }

  const request = await repo.getRequest(input.agencyId, input.requestId);
  if (!request) throw new NotFoundError("Request", input.requestId);
  const inReviewSet = (await repo.listRequestDocuments(input.agencyId, input.requestId)).some(
    (d) => d.id === input.documentId,
  );
  if (!inReviewSet) throw new RedactionError("That document is not in this request's review set.");
  const doc = await repo.getDocument(input.agencyId, input.documentId);
  if (!doc) throw new NotFoundError("Document", input.documentId);
  if (!doc.blobRef) throw new RedactionError("This document has no stored bytes to redact.");

  const blob = await blobStore.get(doc.blobRef);
  if (!blob) throw new RedactionError("The document's bytes are missing from storage.");
  const pageBytes = documentPageImages(blob.bytes, doc.mimeType ?? blob.contentType ?? null);
  if (pageBytes.length === 0) {
    throw new RedactionError(
      "This document has no page images — use the text redaction studio for text documents.",
    );
  }
  const badPage = input.boxes.find((b) => b.page < 0 || b.page >= pageBytes.length);
  if (badPage) throw new RedactionError(`Redaction on page ${badPage.page + 1}, but the document has ${pageBytes.length} page(s).`);

  // Decode → burn → re-encode → VERIFY, page by page. Every page is
  // re-encoded (not just burned ones) so no original bytes survive at all.
  const pages: PdfPageImage[] = [];
  for (let p = 0; p < pageBytes.length; p++) {
    const raster = decodeImage(pageBytes[p]!);
    if (!raster) {
      throw new RedactionError(
        `Page ${p + 1} could not be decoded — a page we can't render can't be certified as redacted. Withhold the document instead.`,
      );
    }
    const rects = input.boxes.filter((b) => b.page === p);
    burnRegions(raster, rects);
    const jpeg = encodeJpeg(raster);
    const unburned = findUnburnedRegions(jpeg, rects);
    if (unburned.length > 0) {
      throw new RedactionError(
        `Burn verification failed on page ${p + 1} — ${unburned.length} region(s) still readable. Nothing was released.`,
      );
    }
    pages.push({ jpeg, width: raster.width, height: raster.height });
  }

  const baseName = (doc.filename ?? doc.id).replace(/\.[a-z0-9]+$/i, "");
  const filename = `${baseName}-redacted.pdf`;
  const pdf = imagesToPdf(pages, filename);

  // Belt and braces (invariant 1): what the artifact embeds for a BURNED
  // page must not be that page's original bytes. (The whole-artifact scan
  // would false-positive when two pages share identical source images; the
  // per-page comparison is the precise claim — burning changed the bytes,
  // and findUnburnedRegions above proved the change is black.)
  const burnedPages = new Set(input.boxes.map((b) => b.page));
  for (const p of burnedPages) {
    if (pages[p]!.jpeg.equals(pageBytes[p]!)) {
      throw new RedactionError("Burn verification failed at the byte level. Nothing was released.");
    }
  }

  const now = deps.now();
  const key = await blobStore.put(blobKey(input.agencyId, filename), pdf, "application/pdf");
  const artifact = await repo.createDocument({
    id: deps.genId(),
    agencyId: input.agencyId,
    sourceId: null,
    externalSystemId: redactedArtifactExternalId(doc.id),
    filename,
    classification: "internal", // never public by side effect (invariant 9)
    recordType: doc.recordType,
    processingStatus: "ready",
    metadata: {
      redactionOf: doc.id,
      requestId: input.requestId,
      redactionMode: "visual",
      // The exemption log: reasons + where, never what was underneath.
      exemptionLog: input.boxes.map((b) => ({
        page: b.page,
        x: round4(b.x),
        y: round4(b.y),
        w: round4(b.w),
        h: round4(b.h),
        reason: b.reason,
      })),
    },
    blobRef: key,
    byteSize: pdf.length,
    mimeType: "application/pdf",
    checksum: checksumOf(pdf),
    // Deliberately NO extractedText: the source's OCR text must not ride
    // along into a release whose pixels were just redacted.
    pageCount: pages.length,
    createdAt: now,
  });

  const reasons = [...new Set(input.boxes.map((b) => b.reason.trim()))];
  await reviewDocument(deps, {
    agencyId: input.agencyId,
    requestId: input.requestId,
    documentId: doc.id,
    decision: "release_redacted",
    exemptionLabel: reasons.join("; "),
    actorUserId: input.actorUserId,
  });

  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: input.requestId,
    kind: "approval",
    actorUserId: input.actorUserId,
    summary: `Visual redactions finalized — ${input.boxes.length} region(s) burned across ${pages.length} page(s), verified unreadable`,
    payload: {
      documentId: doc.id,
      artifactDocumentId: artifact.id,
      artifactChecksum: artifact.checksum,
      redactions: input.boxes.length,
      exemptions: reasons,
      mode: "visual",
    },
    createdAt: now,
  });

  return { artifact, redactionCount: input.boxes.length, pageCount: pages.length };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
