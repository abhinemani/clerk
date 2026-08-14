/**
 * Consistency audit (agentic-horizon B2) — cross-request defensibility.
 *
 * Inconsistency is what loses appeals: the same kind of record released in
 * full on one request and withheld (or redacted under a different statute) on
 * another, with no recorded reason for the divergence. This module finds those
 * divergences in the review-decision log the office already writes
 * (§5 reviews: decision + exemption label + named decider, per document).
 *
 * Pure functions, computeDueDate rules: no I/O, no clock, no model — callers
 * pass the decisions in, findings come out deterministically sorted. The agent
 * and the command-center card both call this, so they can never disagree.
 *
 * Two finding kinds:
 *  - divergent_decision: a record type released in full in one request but
 *    withheld/redacted in another. Sometimes correct (the records differ, the
 *    context differs) — which is exactly why it should be flagged while the
 *    office still remembers why.
 *  - divergent_exemption: the same record type restricted under different
 *    exemption labels across requests. Citing two statutes for one kind of
 *    record invites an appellate "which is it?".
 */

export interface DecisionRecord {
  /** Request the decision was made on (display id, e.g. PR-2026-00104). */
  requestPublicId: string;
  documentId: string;
  documentName: string;
  recordType: string | null;
  decision: "release" | "release_redacted" | "withhold";
  exemptionLabel: string | null;
  decidedAt: Date;
}

export interface DecisionExemplar {
  document: string;
  request: string;
  decision: DecisionRecord["decision"];
  exemption: string | null;
}

export interface ConsistencyFinding {
  kind: "divergent_decision" | "divergent_exemption";
  recordType: string;
  /** One-line human statement of the divergence, request ids included. */
  summary: string;
  /** Distinct requests on each side of the divergence. */
  releasedIn: string[];
  restrictedIn: string[];
  /** Distinct exemption labels cited on the restricted side (display casing). */
  exemptions: string[];
  /** Capped exemplar decisions backing the finding (both sides). */
  exemplars: DecisionExemplar[];
}

// Structural rows (transparencyImpact idiom) — the domain layer never imports
// repository types; callers pass the slices they already loaded.
export interface AuditRequestRow {
  id: string;
  publicId: string;
}
export interface AuditReviewRow {
  requestId: string;
  documentId: string;
  decision: DecisionRecord["decision"];
  exemptionLabel: string | null;
  createdAt: Date;
}
export interface AuditDocumentRow {
  id: string;
  filename: string | null;
  recordType: string | null;
}

/** Join the agency-wide slices into the decision log the audit examines. */
export function decisionRecordsFrom(
  requests: AuditRequestRow[],
  reviews: AuditReviewRow[],
  documents: AuditDocumentRow[],
): DecisionRecord[] {
  const requestById = new Map(requests.map((r) => [r.id, r]));
  const docById = new Map(documents.map((d) => [d.id, d]));
  return reviews.flatMap((r) => {
    const request = requestById.get(r.requestId);
    if (!request) return [];
    const doc = docById.get(r.documentId);
    return [
      {
        requestPublicId: request.publicId,
        documentId: r.documentId,
        documentName: doc?.filename ?? r.documentId,
        recordType: doc?.recordType ?? null,
        decision: r.decision,
        exemptionLabel: r.exemptionLabel,
        decidedAt: r.createdAt,
      },
    ];
  });
}

const EXEMPLAR_CAP = 6;

const norm = (s: string) => s.trim().toLowerCase();

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * Find cross-request inconsistencies in a set of review decisions.
 * Decisions without a record type are skipped (nothing to compare against);
 * divergence within a single request is not a finding (different documents in
 * one request legitimately get different treatment).
 */
export function findInconsistencies(decisions: DecisionRecord[]): ConsistencyFinding[] {
  const byType = new Map<string, DecisionRecord[]>();
  for (const d of decisions) {
    if (!d.recordType?.trim()) continue;
    const key = norm(d.recordType);
    const list = byType.get(key) ?? [];
    list.push(d);
    byType.set(key, list);
  }

  const findings: ConsistencyFinding[] = [];

  for (const key of [...byType.keys()].sort()) {
    const group = byType.get(key)!;
    if (new Set(group.map((d) => d.requestPublicId)).size < 2) continue;

    // Display casing: first-seen non-empty record type.
    const recordType = group.find((d) => d.recordType?.trim())!.recordType!.trim();

    const releasedRequests = uniqueSorted(
      group.filter((d) => d.decision === "release").map((d) => d.requestPublicId),
    );
    const restricted = group.filter((d) => d.decision !== "release");
    const restrictedRequests = uniqueSorted(restricted.map((d) => d.requestPublicId));

    const exemplarsFor = (records: DecisionRecord[]): DecisionExemplar[] =>
      records.slice(0, EXEMPLAR_CAP).map((d) => ({
        document: d.documentName,
        request: d.requestPublicId,
        decision: d.decision,
        exemption: d.exemptionLabel,
      }));

    // Divergent decision: released in full somewhere, restricted somewhere
    // ELSE — the same request doing both is normal per-document review.
    const divergentRequests =
      releasedRequests.some((r) => !restrictedRequests.includes(r)) &&
      restrictedRequests.some((r) => !releasedRequests.includes(r));
    if (releasedRequests.length > 0 && restrictedRequests.length > 0 && divergentRequests) {
      const exemptions = uniqueSorted(
        restricted.map((d) => d.exemptionLabel?.trim()).filter((l): l is string => !!l),
      );
      findings.push({
        kind: "divergent_decision",
        recordType,
        summary: `“${recordType}” records released in full in ${releasedRequests.join(", ")} but ${
          restricted.some((d) => d.decision === "withhold") ? "withheld" : "redacted"
        } in ${restrictedRequests.join(", ")}${exemptions.length ? ` (citing ${exemptions.join("; ")})` : ""}.`,
        releasedIn: releasedRequests,
        restrictedIn: restrictedRequests,
        exemptions,
        exemplars: [
          ...exemplarsFor(group.filter((d) => d.decision === "release")),
          ...exemplarsFor(restricted),
        ].slice(0, EXEMPLAR_CAP),
      });
    }

    // Divergent exemption: the restricted side cites ≥2 distinct labels
    // across ≥2 distinct requests.
    const labelled = restricted.filter((d) => d.exemptionLabel?.trim());
    const distinctLabels = new Map<string, string>(); // norm → display
    for (const d of labelled) {
      const l = d.exemptionLabel!.trim();
      if (!distinctLabels.has(norm(l))) distinctLabels.set(norm(l), l);
    }
    if (
      distinctLabels.size >= 2 &&
      new Set(labelled.map((d) => d.requestPublicId)).size >= 2
    ) {
      const exemptions = [...distinctLabels.values()].sort();
      findings.push({
        kind: "divergent_exemption",
        recordType,
        summary: `“${recordType}” records restricted under ${exemptions.length} different exemptions across ${
          new Set(labelled.map((d) => d.requestPublicId)).size
        } requests: ${exemptions.join(" vs. ")}.`,
        releasedIn: releasedRequests,
        restrictedIn: uniqueSorted(labelled.map((d) => d.requestPublicId)),
        exemptions,
        exemplars: exemplarsFor(labelled),
      });
    }
  }

  return findings;
}
