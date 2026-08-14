/**
 * Production index (Vaughn-style index of records) — the itemized, per-document
 * account of a request's production: what was in the review set, what was
 * released / redacted / withheld, under which exemption, by whom, and in which
 * checksummed release the document actually went out.
 *
 * Courts and requesters ask for exactly this table when a withholding is
 * challenged; assembling it by hand from a file cabinet is why agencies dread
 * the ask. Here it is a projection of records the platform already keeps —
 * §5 reviews (decision + exemption + named decider), the redaction artifacts'
 * exemption logs (reasons + positions, never content), and invariant 8's
 * checksummed releases.
 *
 * Pure builder, auditExport rules: no I/O, no clock — callers pass everything
 * in, so the index is deterministic and testable.
 *
 * This module also owns `compileExemptionLog` — THE one exemption-grouping
 * implementation. The release-prep agent's `compile_exemption_log` capability
 * and this index both call it, so the two can never diverge in how they
 * aggregate citations (they may aggregate different inputs: the agent groups
 * its redaction suggestions mid-flight; the index groups the decided record).
 */
import type {
  DocumentEntity,
  ReleaseEntity,
  RequestEntity,
  ReviewEntity,
} from "@/services/repository";

/** One exemption's aggregate: how often cited, over which documents. */
export interface ExemptionLogEntry {
  exemption: string;
  count: number;
  documents: string[];
}

/**
 * Group per-document exemption citations into the canonical exemption log.
 * Deterministic: count desc, then label asc; document lists keep first-seen
 * order, de-duplicated.
 */
export function compileExemptionLog(
  entries: Array<{ document: string; exemption: string }>,
): ExemptionLogEntry[] {
  const byExemption = new Map<string, { count: number; documents: string[] }>();
  for (const e of entries) {
    const bucket = byExemption.get(e.exemption) ?? { count: 0, documents: [] };
    bucket.count += 1;
    if (!bucket.documents.includes(e.document)) bucket.documents.push(e.document);
    byExemption.set(e.exemption, bucket);
  }
  return [...byExemption.entries()]
    .map(([exemption, b]) => ({ exemption, count: b.count, documents: b.documents }))
    .sort((a, b) => b.count - a.count || a.exemption.localeCompare(b.exemption));
}

export interface ProductionIndexInput {
  agencyName: string;
  request: RequestEntity;
  reviews: ReviewEntity[];
  /** The request's review set (source documents; redacted artifacts are resolved separately). */
  documents: DocumentEntity[];
  /**
   * Redaction artifacts for this agency (documents finalizeRedaction minted:
   * externalSystemId "redacted:<sourceDocId>"). Their metadata carries the
   * exemption log — reasons and positions, never what was underneath.
   */
  redactionArtifacts: DocumentEntity[];
  releases: ReleaseEntity[];
  /** Resolve ids to display names; unknown ids print as user:<id> (still evidence). */
  actorNameById?: Map<string, string>;
  now: Date;
}

export interface ProductionIndexRow {
  n: number;
  document: string;
  recordType: string | null;
  decision: "release" | "release_redacted" | "withhold" | "undecided";
  exemption: string | null;
  decidedBy: string | null;
  /** Distinct redaction reasons burned into this document's released artifact. */
  redactionReasons: string[];
  /** "Released <day> · sha256:<checksum>" when the document went out. */
  release: string | null;
}

export interface ProductionIndex {
  title: string;
  generatedAt: string;
  request: { publicId: string; rawText: string; status: string; receivedAt: string | null };
  rows: ProductionIndexRow[];
  exemptionLog: ExemptionLogEntry[];
  summary: {
    documents: number;
    released: number;
    redacted: number;
    withheld: number;
    undecided: number;
  };
}

const fmt = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19) + "Z";
const fmtDay = (d: Date) => d.toISOString().slice(0, 10);

interface RedactionLogSpan {
  reason?: unknown;
}

function redactionReasonsOf(artifact: DocumentEntity | undefined): string[] {
  const log = artifact?.metadata?.exemptionLog;
  if (!Array.isArray(log)) return [];
  const reasons: string[] = [];
  for (const span of log as RedactionLogSpan[]) {
    if (typeof span?.reason === "string" && span.reason && !reasons.includes(span.reason)) {
      reasons.push(span.reason);
    }
  }
  return reasons;
}

export function buildProductionIndex(input: ProductionIndexInput): ProductionIndex {
  const name = (id: string | null | undefined) =>
    id ? (input.actorNameById?.get(id) ?? `user:${id}`) : null;

  // Latest review per document wins (reviews are append-only; a re-decision
  // supersedes for display while the full history stays in the audit trail).
  const reviewByDoc = new Map<string, ReviewEntity>();
  for (const r of [...input.reviews].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    reviewByDoc.set(r.documentId, r);
  }

  const artifactBySource = new Map<string, DocumentEntity>();
  for (const a of input.redactionArtifacts) {
    const src = a.externalSystemId?.startsWith("redacted:")
      ? a.externalSystemId.slice("redacted:".length)
      : (a.metadata?.redactionOf as string | undefined);
    if (src) artifactBySource.set(src, a);
  }

  // Which release carried each document (by source doc id or its redacted
  // artifact's id; filename as the last resort for legacy artifacts).
  const releaseOf = (doc: DocumentEntity): string | null => {
    const artifact = artifactBySource.get(doc.id);
    for (const rel of input.releases) {
      for (const a of rel.artifacts) {
        const hit =
          a.documentId === doc.id ||
          (artifact && a.documentId === artifact.id) ||
          (!a.documentId && (a.filename === doc.filename || (artifact && a.filename === artifact.filename)));
        if (hit) return `Released ${fmtDay(rel.releasedAt)} · sha256:${a.checksum}`;
      }
    }
    return null;
  };

  // Source documents only — a redacted artifact is a release copy of its
  // source, not a second responsive record.
  const sources = input.documents.filter((d) => !d.externalSystemId?.startsWith("redacted:"));

  const rows: ProductionIndexRow[] = sources.map((doc, i) => {
    const review = reviewByDoc.get(doc.id);
    return {
      n: i + 1,
      document: doc.filename ?? doc.id,
      recordType: doc.recordType,
      decision: review?.decision ?? "undecided",
      exemption: review?.exemptionLabel ?? null,
      decidedBy: review ? name(review.decidedByUserId) : null,
      redactionReasons: redactionReasonsOf(artifactBySource.get(doc.id)),
      release: releaseOf(doc),
    };
  });

  const exemptionLog = compileExemptionLog(
    rows
      .filter((r) => r.decision !== "release" && r.decision !== "undecided" && r.exemption)
      .map((r) => ({ document: r.document, exemption: r.exemption! })),
  );

  return {
    title: `Production index — ${input.request.publicId} · ${input.agencyName}`,
    generatedAt: fmt(input.now),
    request: {
      publicId: input.request.publicId,
      rawText: input.request.rawText,
      status: input.request.status,
      receivedAt: input.request.receivedAt ? fmt(input.request.receivedAt) : null,
    },
    rows,
    exemptionLog,
    summary: {
      documents: rows.length,
      released: rows.filter((r) => r.decision === "release").length,
      redacted: rows.filter((r) => r.decision === "release_redacted").length,
      withheld: rows.filter((r) => r.decision === "withhold").length,
      undecided: rows.filter((r) => r.decision === "undecided").length,
    },
  };
}

const DECISION_LABEL: Record<ProductionIndexRow["decision"], string> = {
  release: "Released in full",
  release_redacted: "Released with redactions",
  withhold: "Withheld",
  undecided: "No decision recorded",
};

/** Plain-text rendering for export (the PDF route wraps this). */
export function renderProductionIndexText(p: ProductionIndex): string {
  const lines: string[] = [
    p.title,
    "=".repeat(p.title.length),
    `Generated ${p.generatedAt}`,
    "",
    `Request ${p.request.publicId}${p.request.receivedAt ? ` · received ${p.request.receivedAt}` : ""} · status: ${p.request.status}`,
    `As filed (immutable, invariant 6): "${p.request.rawText}"`,
    "",
    `Summary: ${p.summary.documents} document(s) — ${p.summary.released} released in full, ${p.summary.redacted} released with redactions, ${p.summary.withheld} withheld${p.summary.undecided > 0 ? `, ${p.summary.undecided} undecided` : ""}.`,
    "",
    "I. INDEX OF RECORDS",
  ];
  if (p.rows.length === 0) lines.push("  (no documents in the review set)");
  for (const r of p.rows) {
    lines.push(
      `  ${r.n}. ${r.document}${r.recordType ? `  [${r.recordType}]` : ""}`,
      `      Decision: ${DECISION_LABEL[r.decision]}${r.exemption ? ` — ${r.exemption}` : ""}${r.decidedBy ? ` (by ${r.decidedBy})` : ""}`,
    );
    if (r.redactionReasons.length > 0) {
      lines.push(`      Redactions applied: ${r.redactionReasons.join("; ")}`);
    }
    lines.push(`      ${r.release ?? "Not released"}`);
  }
  lines.push("", "II. EXEMPTION LOG");
  if (p.exemptionLog.length === 0) lines.push("  (no exemptions cited)");
  for (const e of p.exemptionLog) {
    lines.push(`  ${e.exemption} — cited ${e.count} time(s): ${e.documents.join(", ")}`);
  }
  lines.push(
    "",
    "Every decision above names its human decider; the full append-only audit",
    "trail is available as the defensibility report for this request.",
  );
  return lines.join("\n");
}
