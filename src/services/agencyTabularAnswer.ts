/**
 * Staff-scoped tabular lookup (fulfillment agent v2's connector_search) —
 * the internal-tooling mirror of tabularAnswerService.findTabularAnswer.
 *
 * NEVER call this from a requester-facing surface. It reads
 * repo.searchAgencyDatasetRows, which carries NO classification filter
 * (unlike searchPublicDatasetRows, where invariant 3 is enforced in the
 * query itself) — every row of the matched dataset comes back regardless of
 * whether its slice has published yet. This is for staff tooling that
 * already sees the full corpus (the same posture searchAgencyRecords takes
 * for document search) — today, the fulfillment agent deciding whether a
 * scope item is backed by a connected dataset and, if so, how many rows
 * actually match it.
 *
 * The dataset is resolved from the connectedSource stamps recordsSearchService
 * already attaches to its hits, so ambiguity/ordering rules mirror the public
 * path exactly (composeTabularAnswer is shared and classification-agnostic —
 * only the row fetch differs).
 */
import { parseDateQuery } from "@/domain/dateQuery";
import { readDocumentMeta } from "@/domain/documentMeta";
import { composeTabularAnswer, type TabularAnswer } from "@/domain/tabularAnswer";
import type { ServiceDeps } from "./deps";

const FETCH_LIMIT = 5000;

export async function findAgencyTabularAnswer(
  deps: ServiceDeps,
  input: {
    agencyId: string;
    query: string;
    /** The scope item's corpus_search hits — only their connectedSource stamps matter. */
    items: { connectedSource: { dataset: string; sourceName: string } | null }[];
    now?: Date;
  },
): Promise<TabularAnswer | null> {
  const stamps = input.items
    .map((i) => i.connectedSource)
    .filter((s): s is { dataset: string; sourceName: string } => s != null);
  if (stamps.length === 0) return null;
  const datasets = [...new Set(stamps.map((s) => s.dataset))];
  if (datasets.length !== 1) return null; // ambiguous — refuse, same rule as the public path
  const dataset = datasets[0]!;

  // Staff scope: every slice of the dataset, any classification.
  const allDocs = await deps.repo.listDocuments(input.agencyId);
  const slices = allDocs
    .map((d) => ({ doc: d, meta: readDocumentMeta(d) }))
    .filter(({ meta }) => meta.connectedSource?.dataset === dataset);
  if (slices.length === 0) return null;

  const newest = slices.reduce((a, b) =>
    (a.meta.connectedSource!.syncedAt ?? "") >= (b.meta.connectedSource!.syncedAt ?? "") ? a : b,
  );
  const columns = newest.meta.connectedSource!.columns ?? [];
  const syncedAt = newest.meta.connectedSource!.syncedAt;
  const sourceName = newest.meta.connectedSource!.sourceName;

  const { range, residual } = parseDateQuery(input.query, input.now ?? deps.now());
  const { rows, total } = await deps.repo.searchAgencyDatasetRows(input.agencyId, {
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
    rangeLabel: null,
    residualQuery: residual,
  });
}
