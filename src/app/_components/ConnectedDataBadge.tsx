/**
 * Requester-facing provenance for connected-source dataset slices
 * (docs/connected-sources.md): says where the data comes from, how fresh it
 * is, and that this is an automated answer — not a records determination.
 * Presentational only, safe in server and client components.
 */

export interface ConnectedStampView {
  sourceName: string;
  dataset: string;
  period: string;
  syncedAt: string;
}

/** Compact chip for archive cards and answer-box rows. */
export function ConnectedDataTag({ stamp }: { stamp: ConnectedStampView }) {
  return (
    <span
      className="tag"
      title={`Synced from ${stamp.sourceName} · last sync ${stamp.syncedAt.slice(0, 10)}`}
      style={{ color: "var(--ai)", borderColor: "var(--ai)" }}
    >
      ⟳ City data · {stamp.period}
    </span>
  );
}

/** The full flag, for the record permalink (the spec's copy, verbatim). */
export function ConnectedDataFlag({ stamp }: { stamp: ConnectedStampView }) {
  return (
    <div
      className="card"
      style={{ padding: "12px 16px", background: "var(--ai-tint)", borderColor: "var(--ai)", margin: "14px 0" }}
    >
      <p style={{ margin: 0, fontSize: "0.9rem" }}>
        <strong>Automated answer from the city&apos;s public data.</strong> This record is synced
        from {stamp.sourceName} ({stamp.dataset.replace(/[-_]+/g, " ")}, {stamp.period}; last synced{" "}
        {stamp.syncedAt.slice(0, 10)}). It is informational, not a records determination under the
        public records law. If it doesn&apos;t answer your question, file a request.
      </p>
    </div>
  );
}
