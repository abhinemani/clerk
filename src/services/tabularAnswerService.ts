/**
 * Tabular answers (connected-sources phase 3) — the service gate above the
 * pure composer. This is where the load-bearing refusals live that need the
 * database:
 *
 *  1. ONE dataset only: the archive search's connected-source hits must all
 *     point at the same dataset, or there is no unambiguous table to draw.
 *  2. COMPLETE store only: every PUBLIC slice of that dataset must have its
 *     rows fully materialized (`meta.rowStore.complete`) — a truncated or
 *     not-yet-backfilled slice would make every count silently low.
 *  3. PUBLIC rows only — enforced in the repository query itself
 *     (searchPublicDatasetRows joins documents on classification='public',
 *     invariant 3), not here; this service never sees an internal row.
 *
 * Answers are informational, never a records determination — the card copy
 * carries the same flag as every connected-source answer, and merely
 * DISPLAYING a table logs nothing (the deflection rule is unchanged).
 */
import { parseDateQuery } from "@/domain/dateQuery";
import { readDocumentMeta } from "@/domain/documentMeta";
import { composeTabularAnswer, type TabularAnswer } from "@/domain/tabularAnswer";
import type { ServiceDeps } from "./deps";

/** Fetch page for one answer. Covers a filtered answer for any dataset whose
 *  window holds this many rows or fewer; beyond it, unfiltered counts stay
 *  exact and filtered answers refuse (see composeTabularAnswer). */
const FETCH_LIMIT = 5000;

export async function findTabularAnswer(
  deps: ServiceDeps,
  input: {
    agencyId: string;
    query: string;
    /** The archive search's items — only their connected-source stamps matter. */
    items: { connectedSource: { dataset: string; sourceName: string } | null }[];
    /** The search's own window label ("June–August 2026"), for the basis line. */
    rangeLabel?: string | null;
    now?: Date;
  },
): Promise<TabularAnswer | null> {
  const stamps = input.items
    .map((i) => i.connectedSource)
    .filter((s): s is { dataset: string; sourceName: string } => s != null);
  if (stamps.length === 0) return null;
  const datasets = [...new Set(stamps.map((s) => s.dataset))];
  if (datasets.length !== 1) return null; // ambiguous — refuse (rule 1)
  const dataset = datasets[0]!;

  // Rule 2: every public slice of the dataset must be fully materialized.
  const publicDocs = await deps.repo.listPublicDocuments(input.agencyId);
  const slices = publicDocs
    .map((d) => ({ doc: d, meta: readDocumentMeta(d) }))
    .filter(({ meta }) => meta.connectedSource?.dataset === dataset);
  if (slices.length === 0) return null;
  if (slices.some(({ meta }) => !meta.rowStore?.complete)) return null;

  // Column order + sync recency from the newest slice's stamp.
  const newest = slices.reduce((a, b) =>
    (a.meta.connectedSource!.syncedAt ?? "") >= (b.meta.connectedSource!.syncedAt ?? "") ? a : b,
  );
  const columns = newest.meta.connectedSource!.columns ?? [];
  const syncedAt = newest.meta.connectedSource!.syncedAt;
  const sourceName = newest.meta.connectedSource!.sourceName;

  const { range, residual } = parseDateQuery(input.query, input.now ?? deps.now());
  const { rows, total } = await deps.repo.searchPublicDatasetRows(input.agencyId, {
    dataset,
    from: range?.from,
    to: range?.to,
    limit: FETCH_LIMIT,
  });

  return composeTabularAnswer({
    dataset,
    sourceName,
    syncedAt,
    columns,
    rows: rows.map((r) => ({ data: r.data, recordDate: r.recordDate, period: r.period })),
    totalRows: total,
    rangeLabel: input.rangeLabel ?? null,
    residualQuery: residual,
  });
}
