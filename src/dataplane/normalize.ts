/**
 * Ingestion normalization pipeline (spec §9.3).
 *
 *   receive → (virus scan) → extract/OCR → auto-classify → sensitivity pre-scan
 *           → publish (ready) or hold (review queue)
 *
 * Every on-ramp (§9.1) funnels through this one pure function. A source's trust
 * setting decides auto-accept vs. review queue, but the §6.5 sensitivity pre-scan
 * can force ANY item into review regardless of trust — e.g. a "public" contract
 * exhibit that turns out to contain SSNs. Pure and testable.
 */
import { scanPii, summarizePii, type PiiFinding } from "@/ai/redaction/piiScan";
import type { DocumentEntity } from "@/services/repository";

export interface SourceConfig {
  id: string;
  trust: "auto_publish" | "review_queue";
  defaultClassification: "public" | "internal";
  defaultRecordType?: string;
}

export interface IngestPayload {
  externalId?: string;
  filename?: string;
  recordType?: string;
  classification?: "public" | "internal";
  /** Extracted/OCR'd text (already produced by the caller in this pass). */
  text?: string;
  metadata?: Record<string, unknown>;
  deepLink?: string;
}

export interface NormalizeResult {
  document: DocumentEntity;
  /** In the review queue (not auto-accepted). */
  held: boolean;
  /** Visible to the public (accepted AND classified public). */
  publicVisible: boolean;
  holdReason?: string;
  sensitivity: Record<string, number>;
}

/** Findings at this confidence or above force an item into review. */
function hasHighRiskPii(findings: PiiFinding[]): boolean {
  return findings.some((f) => f.confidence === "high");
}

export function normalizeIngest(
  payload: IngestPayload,
  source: SourceConfig,
  deps: { genId: () => string; now: () => Date; agencyId: string },
): NormalizeResult {
  const classification = payload.classification ?? source.defaultClassification;
  const recordType = payload.recordType ?? source.defaultRecordType ?? null;

  // Sensitivity pre-scan (§6.5 / §9.3).
  const findings = scanPii(payload.text ?? "");
  const sensitivity = summarizePii(findings);
  const sensitiveHold = hasHighRiskPii(findings);

  const held = source.trust === "review_queue" || sensitiveHold;
  let holdReason: string | undefined;
  if (sensitiveHold) {
    holdReason = `Sensitivity pre-scan flagged probable PII (${Object.keys(sensitivity).join(", ")}); held for review.`;
  } else if (source.trust === "review_queue") {
    holdReason = "Source is review-queue trust; awaiting classification thumbs-up.";
  }

  const publicVisible = !held && classification === "public";

  const document: DocumentEntity = {
    id: deps.genId(),
    agencyId: deps.agencyId,
    sourceId: source.id,
    externalSystemId: payload.externalId ?? null,
    filename: payload.filename ?? null,
    classification,
    recordType,
    processingStatus: held ? "held" : "ready",
    metadata: {
      ...(payload.metadata ?? {}),
      ...(payload.deepLink ? { deepLink: payload.deepLink } : {}),
      sensitivity,
    },
    createdAt: deps.now(),
  };

  return { document, held, publicVisible, holdReason, sensitivity };
}
