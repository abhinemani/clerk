/**
 * "Has someone asked this before?" — the query layer for the learning loop
 * (docs/answer-first.md, phase 3).
 *
 * Retrieve-then-rerank, in three stages, each of which exists for a reason:
 *
 *   1. SCOPE   — build the candidate set the audience is allowed to see.
 *   2. RETRIEVE— narrow thousands of prior requests to a handful (BM25, or
 *                Elasticsearch when configured).
 *   3. JUDGE   — a model decides which of that handful genuinely answer the
 *                new ask, with a rationale a resident can read.
 *
 * Stage 1 comes FIRST on purpose. For a requester audience, prior requests
 * whose records were released privately never enter the candidate list at
 * all — so they are not in the retrieval corpus, not in the prompt, and not
 * in the model's context. Filtering after the model would leave private
 * scopes sitting in a prompt, which is a disclosure risk even when the output
 * is discarded (invariant 3 is about what the query layer can REACH, not only
 * what it returns).
 *
 * Degrades all the way down: no Elasticsearch → BM25; no ANTHROPIC_API_KEY →
 * retrieval-only results, clearly marked as unjudged. An agency with zero
 * external services still gets "someone asked this before".
 */
import type { ServiceDeps } from "./deps";
import type { DocumentEntity, RequestEntity } from "./repository";
import { getSearchIndex, type IndexedDoc } from "@/adapters/searchIndex";
import { readDocumentMeta } from "@/domain/documentMeta";
import {
  REQUESTER_MATCH_FLOOR,
  STAFF_MATCH_FLOOR,
  reconcileMatches,
  requestMatchPipeline,
  type PriorMatch,
  type RequestMatchCandidate,
} from "@/ai/pipelines/requestMatch";
import type { ModelClient } from "@/ai/modelClient";

export type Audience = "requester" | "staff";

export interface PriorAnswer extends PriorMatch {
  requestId: string;
  /** Documents a resident may actually be handed. Public-only for requesters. */
  documents: Array<{ id: string; title: string }>;
}

export interface PriorAnswerResult {
  matches: PriorAnswer[];
  /** How many prior requests survived scoping and were searched. */
  considered: number;
  /** False when no model was available — matches are retrieval-only. */
  judged: boolean;
  indexKind: "builtin" | "elasticsearch";
}

/** Statuses where records actually reached the requester. A denial or a
 *  no-records determination released nothing, so it can answer nothing. */
const ANSWERED = new Set(["fulfilled", "partially_fulfilled"]);

/** How many candidates the model sees. Keeping this small is what makes the
 *  judge affordable and its attention undivided. */
const RERANK_WINDOW = 8;

function summarizeDocs(docs: DocumentEntity[]): string {
  return docs
    .map((d) => readDocumentMeta(d).title ?? d.filename ?? "untitled record")
    .slice(0, 6)
    .join("; ");
}

/**
 * Find prior requests whose released records may answer a new ask.
 *
 * `audience` is the disclosure fork and is not optional — a caller must state
 * who is asking, because that decides what may even be considered.
 */
export async function findPriorAnswers(
  deps: Pick<ServiceDeps, "repo">,
  input: {
    agencyId: string;
    ask: string;
    audience: Audience;
    /** Omit to run retrieval-only (no AI key configured). */
    modelClient?: ModelClient;
    limit?: number;
  },
): Promise<PriorAnswerResult> {
  const { repo } = deps;
  const index = getSearchIndex();
  const empty: PriorAnswerResult = {
    matches: [],
    considered: 0,
    judged: false,
    indexKind: index.kind,
  };
  const ask = input.ask.trim();
  if (ask.length < 8) return empty;

  // ---- 1. SCOPE -----------------------------------------------------------
  const all = await repo.listRequests(input.agencyId);
  const answered = all.filter((r) => ANSWERED.has(r.status));
  if (answered.length === 0) return empty;

  const scoped: Array<{
    request: RequestEntity;
    docs: DocumentEntity[];
    candidate: RequestMatchCandidate;
  }> = [];

  for (const r of answered) {
    const [docs, releases] = await Promise.all([
      repo.listRequestDocuments(input.agencyId, r.id),
      repo.listReleases(input.agencyId, r.id),
    ]);
    if (releases.length === 0) continue;

    // A requester may only ever be shown records that are public in their own
    // right. Both gates matter: the release had to be public AND the document
    // has to still be classified public today — a record can be unpublished
    // after the fact (the audited emergency-unpublish path), and this must
    // follow that decision rather than remember the old one.
    const visible =
      input.audience === "requester"
        ? releases.some((rel) => rel.visibility === "public")
          ? docs.filter((d) => d.classification === "public")
          : []
        : docs;
    if (visible.length === 0) continue;

    scoped.push({
      request: r,
      docs: visible,
      candidate: {
        publicId: r.publicId,
        ask: r.interpretedScope ?? r.rawText,
        outcome: r.status,
        releasedSummary: summarizeDocs(visible),
      },
    });
  }
  if (scoped.length === 0) return { ...empty, considered: 0 };

  // ---- 2. RETRIEVE --------------------------------------------------------
  const corpus: IndexedDoc[] = scoped.map((s) => ({
    id: s.request.publicId,
    title: s.candidate.ask,
    text: `${s.candidate.ask} ${s.candidate.releasedSummary}`,
    // Every alias any released record accumulated is another phrasing that
    // should retrieve this prior request. The loop feeds its own matcher.
    askedAs: s.docs.flatMap((d) => readDocumentMeta(d).askedAs ?? []),
    classification: "public",
  }));

  const hits = await index.search(ask, corpus, { limit: RERANK_WINDOW });
  if (hits.length === 0) return { ...empty, considered: scoped.length };

  const byPublicId = new Map(scoped.map((s) => [s.request.publicId, s]));
  const shortlist = hits.map((h) => byPublicId.get(h.id)!).filter(Boolean);

  // ---- 3. JUDGE -----------------------------------------------------------
  const floor = input.audience === "requester" ? REQUESTER_MATCH_FLOOR : STAFF_MATCH_FLOOR;

  if (!input.modelClient) {
    // Retrieval-only. Deliberately conservative: report the single best hit
    // and mark it unjudged, rather than implying a precision we did not earn.
    const top = shortlist.slice(0, 1).map((s) => ({
      ...s.candidate,
      requestId: s.request.id,
      coverage: "partial" as const,
      confidence: 0,
      rationale: "Similar to an earlier request — not yet checked by review.",
      documents: s.docs.map((d) => ({
        id: d.id,
        title: readDocumentMeta(d).title ?? d.filename ?? "Released record",
      })),
    }));
    return { matches: top, considered: scoped.length, judged: false, indexKind: index.kind };
  }

  try {
    const { runPipeline } = await import("@/ai/runPipeline");
    const result = await runPipeline(
      requestMatchPipeline,
      { newRequest: ask, candidates: shortlist.map((s) => s.candidate) },
      { modelClient: input.modelClient },
    );
    const reconciled = reconcileMatches(result.output, shortlist.map((s) => s.candidate), floor);
    const matches: PriorAnswer[] = reconciled
      .map((m) => {
        const s = byPublicId.get(m.publicId)!;
        return {
          ...m,
          requestId: s.request.id,
          documents: s.docs.map((d) => ({
            id: d.id,
            title: readDocumentMeta(d).title ?? d.filename ?? "Released record",
          })),
        };
      })
      .slice(0, input.limit ?? 3);
    return { matches, considered: scoped.length, judged: true, indexKind: index.kind };
  } catch (e) {
    // A matcher failure must never block filing — the whole point is that the
    // formal workflow still runs.
    console.error("prior-answer match failed", e);
    return { ...empty, considered: scoped.length };
  }
}
