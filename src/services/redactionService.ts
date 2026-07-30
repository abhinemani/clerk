/**
 * Redaction finalize (spec §6.5; docs/invariants.md #1, #4).
 *
 * A named human finalizes the accepted redaction spans for one document in a
 * request's review set. This service:
 *  1. burns the spans into the text rendition (`applyRedactions` — characters
 *     removed, not covered),
 *  2. verifies the burn (`findLeaks` — any recoverable redacted value aborts),
 *  3. regenerates a release artifact PDF from the surviving text only
 *     (`renderTextPdf` — redacted content is never written into the file),
 *  4. stores the artifact (new blob, new checksum, new document row under
 *     `redacted:{documentId}` — re-finalizing creates a new version, priors
 *     stay immutable),
 *  5. records the release_redacted review decision under the actor's name and
 *     appends the audit event with the exemption log (reasons + positions —
 *     NEVER the redacted values themselves).
 *
 * releaseRequest() refuses a release_redacted decision without this artifact,
 * which closes the invariant-1 hole of shipping original bytes renamed
 * "-redacted".
 */
import { blobKey, checksumOf } from "@/adapters/blobStore";
import { applyRedactions, findLeaks, redactedValues, type RedactionSpan } from "@/domain/redaction";
import { renderTextPdf } from "@/domain/textPdf";
import type { ServiceDeps } from "./deps";
import { NotFoundError, type DocumentEntity } from "./repository";
import { reviewDocument } from "./releaseService";

export class RedactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedactionError";
  }
}

/** The external id that ties a burned artifact back to its source document. */
export function redactedArtifactExternalId(documentId: string): string {
  return `redacted:${documentId}`;
}

export interface FinalizeRedactionInput {
  agencyId: string;
  requestId: string;
  documentId: string;
  /** The named human finalizing — required (invariant 4). */
  actorUserId: string;
  /** Accepted spans; each carries its exemption reason. */
  spans: (RedactionSpan & { reason: string })[];
}

export interface FinalizeRedactionOutcome {
  artifact: DocumentEntity;
  redactionCount: number;
}

export async function finalizeRedaction(
  deps: ServiceDeps,
  input: FinalizeRedactionInput,
): Promise<FinalizeRedactionOutcome> {
  const { repo, blobStore } = deps;
  if (!input.actorUserId) throw new RedactionError("Finalizing redactions requires a named user.");
  if (!blobStore) throw new RedactionError("No blob store configured — cannot mint the artifact.");
  if (input.spans.length === 0) {
    throw new RedactionError("No redactions to burn — release the document in full instead.");
  }
  const missingReason = input.spans.find((s) => !s.reason?.trim());
  if (missingReason) throw new RedactionError("Every redaction needs an exemption reason.");

  const request = await repo.getRequest(input.agencyId, input.requestId);
  if (!request) throw new NotFoundError("Request", input.requestId);
  const inReviewSet = (await repo.listRequestDocuments(input.agencyId, input.requestId)).some(
    (d) => d.id === input.documentId,
  );
  if (!inReviewSet) throw new RedactionError("That document is not in this request's review set.");
  const doc = await repo.getDocument(input.agencyId, input.documentId);
  if (!doc) throw new NotFoundError("Document", input.documentId);
  if (!doc.extractedText) {
    throw new RedactionError(
      "No extractable text — a document we can't read can't be certified as redacted. Withhold it or release it in full.",
    );
  }

  const lines = doc.extractedText.split("\n");
  const values = redactedValues(lines, input.spans);
  const released = applyRedactions(lines, input.spans);

  // The mandated leak check (invariant 1): abort rather than ship a leak.
  const leaks = findLeaks(released, values);
  if (leaks.length > 0) {
    throw new RedactionError(
      `Burn verification failed — ${leaks.length} redacted value(s) still present. Nothing was released.`,
    );
  }

  const baseName = (doc.filename ?? doc.id).replace(/\.[a-z0-9]+$/i, "");
  const filename = `${baseName}-redacted.pdf`;
  const pdf = renderTextPdf(released, filename);

  // Belt and braces: the artifact bytes themselves must not contain the values.
  const rawArtifact = pdf.toString("latin1");
  const byteLeak = values.filter((v) => v.trim().length > 0 && rawArtifact.includes(v));
  if (byteLeak.length > 0) {
    throw new RedactionError("Burn verification failed at the byte level. Nothing was released.");
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
      // The exemption log: reasons + where, never what was underneath.
      exemptionLog: input.spans.map((s) => ({
        line: s.line,
        startCol: s.startCol,
        endCol: s.endCol,
        reason: s.reason,
      })),
    },
    blobRef: key,
    byteSize: pdf.length,
    mimeType: "application/pdf",
    checksum: checksumOf(pdf),
    extractedText: released.join("\n"),
    pageCount: doc.pageCount ?? 1,
    createdAt: now,
  });

  // The decision itself — release_redacted, under the actor's name.
  const reasons = [...new Set(input.spans.map((s) => s.reason.trim()))];
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
    summary: `Redactions finalized — ${input.spans.length} region(s) burned, verified leak-free`,
    payload: {
      documentId: doc.id,
      artifactDocumentId: artifact.id,
      artifactChecksum: artifact.checksum,
      redactions: input.spans.length,
      exemptions: reasons,
    },
    createdAt: now,
  });

  return { artifact, redactionCount: input.spans.length };
}

/** The current burned artifact for a review-set document, if one exists. */
export async function findRedactedArtifact(
  deps: ServiceDeps,
  agencyId: string,
  documentId: string,
): Promise<DocumentEntity | null> {
  return deps.repo.findLatestDocumentByExternalId(agencyId, redactedArtifactExternalId(documentId));
}
