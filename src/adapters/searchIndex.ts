/**
 * Search index adapter (docs/answer-first.md).
 *
 * The owner asked for Elasticsearch "or some other smart searching function".
 * Both, in the order the house rules require: the BUILT-IN index is real BM25
 * and ships with zero services, and Elasticsearch is an opt-in adapter behind
 * `ELASTICSEARCH_URL` that degrades back to built-in the moment it is
 * unreachable. Same shape as email, virus scan, OCR and storage — and the
 * same reason: an agency must be able to run this on one machine it owns
 * without standing up a cluster (self-contained first, owner preference on
 * the record in CLAUDE.md).
 *
 * What changed materially: scoring used to be `+1 per query term that appears
 * anywhere in the haystack`. That has no term weighting, no length
 * normalisation and no saturation, so a long document mentioning "contract"
 * nine times beat a short one that is exactly about the contract. BM25 fixes
 * all three, and it is ~40 lines of arithmetic with no dependency.
 *
 * HTTP is fetch-only, no SDK — same rule the email providers follow.
 */

export interface IndexedDoc {
  id: string;
  title: string;
  text: string;
  /** Plain-language asks this record has answered (the alias loop). */
  askedAs?: string[];
  classification: "public" | "internal";
}

export interface SearchHit {
  id: string;
  score: number;
  /** One line of "why this matched", for the §6.4 rationale requirement. */
  why: string;
  /** True when the match came from an ask alias rather than the record itself. */
  viaAlias: boolean;
}

export interface SearchIndexOptions {
  limit?: number;
}

export interface SearchIndex {
  readonly kind: "builtin" | "elasticsearch";
  search(query: string, corpus: IndexedDoc[], opts?: SearchIndexOptions): Promise<SearchHit[]>;
}

const STOPWORDS = new Set([
  "the", "and", "for", "you", "are", "was", "has", "have", "had", "not", "but",
  "any", "all", "can", "our", "its", "out", "with", "that", "this", "from",
  "your", "their", "into", "who", "what", "where", "when", "does", "did",
  "give", "get", "want", "show", "please", "need", "would", "could", "about",
  "there", "last", "past", "recent", "previous",
]);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** BM25 tuning. k1 controls term-frequency saturation, b length normalisation. */
const K1 = 1.5;
const B = 0.75;
/** Alias hits count for more than body hits: a prior requester's phrasing is a
 *  human-confirmed label for this record, not an incidental word in its text. */
const ALIAS_BOOST = 1.6;

interface Field {
  tokens: string[];
  counts: Map<string, number>;
}

function field(text: string): Field {
  const tokens = tokenize(text);
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return { tokens, counts };
}

/**
 * BM25 over the corpus, with ask aliases scored as a separate boosted field.
 * Pure and dependency-free — this is the default path, so it must work on a
 * laptop with no services running.
 */
export class BuiltinSearchIndex implements SearchIndex {
  readonly kind = "builtin" as const;

  async search(
    query: string,
    corpus: IndexedDoc[],
    opts: SearchIndexOptions = {},
  ): Promise<SearchHit[]> {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0 || corpus.length === 0) return [];

    const bodies = corpus.map((d) => field(`${d.title} ${d.text}`));
    const aliases = corpus.map((d) => field((d.askedAs ?? []).join(" ")));
    const avgLen = bodies.reduce((s, f) => s + f.tokens.length, 0) / bodies.length || 1;

    // Document frequency across the body field — the usual IDF denominator.
    const df = new Map<string, number>();
    for (const t of terms) {
      df.set(t, bodies.filter((f) => f.counts.has(t)).length);
    }

    const hits: SearchHit[] = [];
    for (let i = 0; i < corpus.length; i++) {
      const body = bodies[i]!;
      const alias = aliases[i]!;
      let score = 0;
      const matchedTerms: string[] = [];
      let aliasOnly = 0;

      for (const t of terms) {
        const n = df.get(t) ?? 0;
        // Standard BM25 IDF, floored so a term in every document contributes
        // ~0 rather than going negative and penalising a legitimate match.
        const idf = Math.max(0.01, Math.log(1 + (corpus.length - n + 0.5) / (n + 0.5)));
        const tf = body.counts.get(t) ?? 0;
        if (tf > 0) {
          const norm = tf * (K1 + 1);
          const denom = tf + K1 * (1 - B + (B * body.tokens.length) / avgLen);
          score += idf * (norm / denom);
          matchedTerms.push(t);
        }
        const atf = alias.counts.get(t) ?? 0;
        if (atf > 0) {
          score += idf * ALIAS_BOOST * ((atf * (K1 + 1)) / (atf + K1));
          if (tf === 0) aliasOnly++;
          if (!matchedTerms.includes(t)) matchedTerms.push(t);
        }
      }

      if (score <= 0) continue;
      hits.push({
        id: corpus[i]!.id,
        score,
        why:
          aliasOnly > 0
            ? `Answered an earlier request phrased like this (${matchedTerms.join(", ")})`
            : `Matched ${matchedTerms.join(", ")}`,
        viaAlias: aliasOnly > 0,
      });
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 25);
  }
}

/**
 * Elasticsearch / OpenSearch adapter. Opt-in via `ELASTICSEARCH_URL`, fetch
 * only, and it FALLS BACK rather than failing: search is a read path, and a
 * cluster being down must never stop a resident finding a record we already
 * publish.
 *
 * Not yet exercised against a live cluster — see docs/answer-first.md. Treat
 * the query shape as a starting point, not a tuned configuration.
 */
export class ElasticSearchIndex implements SearchIndex {
  readonly kind = "elasticsearch" as const;

  constructor(
    private readonly url: string,
    private readonly index: string,
    private readonly fallback: SearchIndex = new BuiltinSearchIndex(),
    private readonly apiKey?: string,
  ) {}

  async search(
    query: string,
    corpus: IndexedDoc[],
    opts: SearchIndexOptions = {},
  ): Promise<SearchHit[]> {
    const limit = opts.limit ?? 25;
    // The corpus is the authority on WHAT this tenant may see. Elasticsearch
    // ranks; it never widens the set. Anything it returns that is not in the
    // caller's corpus is dropped — that keeps invariant 3 enforced here even
    // if the cluster's index is stale or over-broad.
    const allowed = new Map(corpus.map((d) => [d.id, d]));
    try {
      const res = await fetch(`${this.url.replace(/\/$/, "")}/${this.index}/_search`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `ApiKey ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          size: limit,
          query: {
            multi_match: {
              query,
              // askedAs is boosted for the same reason the builtin boosts it:
              // it is a human-confirmed label, not incidental text.
              fields: ["title^2", "askedAs^3", "text"],
              type: "best_fields",
              fuzziness: "AUTO",
            },
          },
        }),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(`elasticsearch ${res.status}`);
      const json = (await res.json()) as {
        hits?: { hits?: Array<{ _id: string; _score: number; matched_queries?: string[] }> };
      };
      const raw = json.hits?.hits ?? [];
      const hits = raw
        .filter((h) => allowed.has(h._id))
        .map((h) => ({
          id: h._id,
          score: h._score,
          why: "Matched by full-text search",
          viaAlias: false,
        }));
      // An empty result from a healthy cluster is a real answer; a THROW is
      // what triggers fallback. Distinguishing those matters — otherwise a
      // genuinely empty search silently re-runs locally and disagrees.
      return hits;
    } catch (e) {
      console.error("elasticsearch search failed — falling back to builtin", e);
      return this.fallback.search(query, corpus, opts);
    }
  }
}

interface SearchIndexGlobal {
  __brandeisSearchIndex?: SearchIndex;
}

/** Memoized like the other adapters. Restart dev servers after changing this
 *  (HANDOFF gotcha 2 — globalThis memoization survives HMR). */
export function getSearchIndex(): SearchIndex {
  const g = globalThis as unknown as SearchIndexGlobal;
  if (!g.__brandeisSearchIndex) {
    const url = process.env.ELASTICSEARCH_URL;
    g.__brandeisSearchIndex = url
      ? new ElasticSearchIndex(
          url,
          process.env.ELASTICSEARCH_INDEX ?? "brandeis-records",
          new BuiltinSearchIndex(),
          process.env.ELASTICSEARCH_API_KEY,
        )
      : new BuiltinSearchIndex();
  }
  return g.__brandeisSearchIndex;
}
