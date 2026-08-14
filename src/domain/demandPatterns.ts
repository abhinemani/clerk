/**
 * Demand-pattern mining (agentic-horizon B1) — the pure core of the
 * proactive-disclosure librarian.
 *
 * Input: everything the platform already knows people ASKED for — resolved
 * requests, deflection-log queries, and archive misses (searched, found
 * nothing, filed anyway). Output: clusters of repeated demand, each a
 * publication candidate ("4 requests + 3 unanswered searches about towing
 * contracts this quarter — publish the series").
 *
 * Deterministic on purpose: token-overlap clustering, no model, no clock —
 * `now` comes in as an argument (same rule as computeDueDate). The librarian
 * agent only PROPOSES from these patterns; publishing stays a named human's
 * act (invariant 9).
 */

export type DemandSignalKind = "request" | "deflection_query" | "archive_miss";

export interface DemandSignal {
  kind: DemandSignalKind;
  /** The ask itself: request text/scope, or the search query. */
  text: string;
  at: Date;
  /** Display reference (a request publicId; queries have none). */
  ref?: string;
}

export interface DemandPattern {
  /** Short human label built from the cluster's most common terms. */
  topic: string;
  /** The shared terms, strongest first — also a ready-made search query. */
  keywords: string[];
  total: number;
  requests: number;
  queries: number;
  misses: number;
  /** Request publicIds in the cluster (deduped, insertion order). */
  refs: string[];
  /** Newest signal in the cluster. */
  lastAt: Date;
}

export interface MineOptions {
  now: Date;
  /** Look-back window; signals older than this are ignored. Default 90 days. */
  windowDays?: number;
  /** Minimum cluster size to surface. Default 3. */
  minCount?: number;
  /** Maximum patterns returned. Default 5. */
  maxPatterns?: number;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "at", "by",
  "from", "with", "about", "all", "any", "are", "was", "were", "is", "be",
  "been", "this", "that", "these", "those", "it", "its", "as", "into",
  "records", "record", "request", "requests", "requesting", "copies", "copy",
  "documents", "document", "please", "would", "like", "want", "need", "get",
  "city", "county", "public", "information", "regarding", "related", "between",
  "since", "during", "last", "recent", "year", "years", "month", "months",
]);

/** Lowercased, stopword-filtered content terms of one signal. */
export function demandTerms(text: string): Set<string> {
  const terms = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue;
    terms.add(raw);
  }
  return terms;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  const smaller = Math.min(a.size, b.size);
  return smaller === 0 ? 0 : shared / smaller;
}

interface Cluster {
  members: { signal: DemandSignal; terms: Set<string> }[];
  /** Term → member count, for labeling and centroid matching. */
  termCounts: Map<string, number>;
}

const OVERLAP_THRESHOLD = 0.5;

/**
 * Mine repeated-demand clusters from the window's signals. Greedy single-pass
 * clustering on term overlap against the cluster's common-term profile —
 * O(signals × clusters), deterministic given input order (callers pass
 * signals oldest-first for stable results).
 */
export function mineDemandPatterns(signals: DemandSignal[], opts: MineOptions): DemandPattern[] {
  const windowDays = opts.windowDays ?? 90;
  const minCount = opts.minCount ?? 3;
  const maxPatterns = opts.maxPatterns ?? 5;
  const cutoff = opts.now.getTime() - windowDays * 86_400_000;

  const clusters: Cluster[] = [];
  for (const signal of signals) {
    if (signal.at.getTime() < cutoff || signal.at.getTime() > opts.now.getTime()) continue;
    const terms = demandTerms(signal.text);
    if (terms.size === 0) continue;

    let best: Cluster | null = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      // Match against terms shared by at least half the cluster — the topic,
      // not one member's noise.
      const half = cluster.members.length / 2;
      const profile = new Set<string>();
      for (const [t, n] of cluster.termCounts) if (n >= half) profile.add(t);
      const score = overlap(terms, profile);
      if (score >= OVERLAP_THRESHOLD && score > bestScore) {
        best = cluster;
        bestScore = score;
      }
    }

    if (best) {
      best.members.push({ signal, terms });
      for (const t of terms) best.termCounts.set(t, (best.termCounts.get(t) ?? 0) + 1);
    } else {
      clusters.push({
        members: [{ signal, terms }],
        termCounts: new Map([...terms].map((t) => [t, 1])),
      });
    }
  }

  const patterns: DemandPattern[] = [];
  for (const cluster of clusters) {
    if (cluster.members.length < minCount) continue;
    const half = cluster.members.length / 2;
    const keywords = [...cluster.termCounts.entries()]
      .filter(([, n]) => n >= half)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t]) => t)
      .slice(0, 5);
    if (keywords.length === 0) continue;

    const refs: string[] = [];
    for (const m of cluster.members) {
      if (m.signal.ref && !refs.includes(m.signal.ref)) refs.push(m.signal.ref);
    }
    const by = (kind: DemandSignalKind) =>
      cluster.members.filter((m) => m.signal.kind === kind).length;

    patterns.push({
      topic: keywords.slice(0, 3).join(" "),
      keywords,
      total: cluster.members.length,
      requests: by("request"),
      queries: by("deflection_query"),
      misses: by("archive_miss"),
      refs,
      lastAt: new Date(Math.max(...cluster.members.map((m) => m.signal.at.getTime()))),
    });
  }

  return patterns
    .sort((a, b) => b.total - a.total || b.lastAt.getTime() - a.lastAt.getTime())
    .slice(0, maxPatterns);
}
