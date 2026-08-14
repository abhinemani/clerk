/**
 * Precedent retrieval for RAG'd triage (docs/answer-first.md phase 4).
 *
 * Request #10,000 should not get the byte-identical prompt request #1 got.
 * This service finds the k nearest RESOLVED requests — ones a human has
 * already triaged, routed, and (ideally) closed — and packages their
 * outcomes as few-shot context for the intake prompts. No fine-tuning, no
 * training pipeline: the corpus is the office's own audited history, and
 * every precedent is attributable to named-human decisions already on the
 * record.
 *
 * STAFF-ONLY SURFACE. Precedents feed the triage/routing prompts that
 * coordinators see; nothing here is requester-facing, so scope filtering is
 * about usefulness (only human-reviewed requests teach anything), not
 * invariant 3 — which governs the requester-facing pre-filing matcher in
 * priorAnswerService, a different thing.
 *
 * Retrieval: cosine over stored ask vectors (requests.embedding — written at
 * submit and backfilled by embed_requests). Requests without a vector fall
 * back to token overlap, so a corpus imported yesterday contributes
 * precedents today even before the backfill has run.
 */
import { cosine, type EmbeddingProvider } from "@/ai/search/embeddings";
import { getEmbeddingProvider } from "@/ai/search/voyage";
import type { ServiceDeps } from "./deps";
import type { RequestEntity } from "./repository";

export interface ResolvedPrecedent {
  publicId: string;
  /** The resident's ask, as filed (trimmed for prompt budget). */
  ask: string;
  /** The human-accepted interpretation. */
  interpretedScope: string;
  recordTypes: string[];
  /** Departments that actually worked it (dispatched tasks). */
  departments: string[];
  /** Where it ended: "closed" | its current status for still-open ones. */
  outcome: string;
  complexityScore: number | null;
  similarity: number;
}

const ASK_SNIPPET = 280;

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length >= 3),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** The text a request's ask vector embeds — one definition, used by every writer. */
export function requestEmbeddingText(r: Pick<RequestEntity, "rawText" | "interpretedScope">): string {
  // The human-accepted scope is cleaner signal than raw text when it exists,
  // but the vector is written AT SUBMIT (before triage), so raw text leads.
  return [r.rawText, r.interpretedScope ?? ""].join("\n").trim().slice(0, 4000);
}

/**
 * Best-effort ask-vector write. Never throws: an embedding provider being
 * down must not be the reason a request cannot be filed (the same rule as
 * alias writes). Exported for submit, the backfill job, and tests.
 */
export async function writeRequestEmbedding(
  deps: ServiceDeps,
  input: { agencyId: string; requestId: string },
  embedder: EmbeddingProvider = getEmbeddingProvider(),
): Promise<boolean> {
  try {
    const request = await deps.repo.getRequest(input.agencyId, input.requestId);
    if (!request) return false;
    const [vector] = await embedder.embed([requestEmbeddingText(request)]);
    if (!vector) return false;
    await deps.repo.setRequestEmbedding(input.agencyId, input.requestId, vector);
    return true;
  } catch (e) {
    console.error("[similarRequests] embedding write failed (non-fatal)", e);
    return false;
  }
}

export interface DuplicateRequestMatch {
  id: string;
  publicId: string;
  similarity: number;
  status: string;
}

/**
 * Duplicate detection at intake (§6.2), on STORED vectors.
 *
 * The filing's own ask vector was written moments earlier in submitRequest,
 * so the common case costs ZERO embed calls: read the store, cosine against
 * every other stored vector. The trap this replaces (HANDOFF build-candidate
 * #3): the naive path would re-embed the whole corpus on every filing.
 *
 * Degradation, per row: a candidate without a stored vector — or a corpus
 * with no vectors at all (backfill not yet run) — falls back to token
 * overlap, so duplicate flags never wait on the embed pipeline. Thresholds
 * are PER METRIC because the scales differ: cosine on real embeddings runs
 * high (unrelated asks can score 0.4), Jaccard runs low.
 */
export async function findDuplicateRequests(
  deps: ServiceDeps,
  input: { agencyId: string; requestId: string; text: string; limit?: number },
): Promise<DuplicateRequestMatch[]> {
  const limit = input.limit ?? 3;
  const { repo } = deps;
  const candidates = (await repo.listRequests(input.agencyId)).filter(
    (r) => r.id !== input.requestId,
  );
  if (candidates.length === 0) return [];

  const stored = new Map(
    (await repo.listRequestEmbeddings(input.agencyId)).map((e) => [e.id, e.embedding] as const),
  );
  const queryVec = stored.get(input.requestId) ?? null;
  const queryTokens = tokens(input.text);

  const VEC_THRESHOLD = 0.6; // cosine over embeddings — near-duplicate territory
  const LEX_THRESHOLD = 0.35; // Jaccard — the original intake calibration

  return candidates
    .map((r) => {
      const vec = queryVec ? stored.get(r.id) : undefined;
      const similarity = vec
        ? cosine(queryVec!, vec)
        : overlap(queryTokens, tokens(requestEmbeddingText(r)));
      return { id: r.id, publicId: r.publicId, similarity, status: r.status, metric: vec ? "vec" : "lex" };
    })
    .filter((s) => s.similarity >= (s.metric === "vec" ? VEC_THRESHOLD : LEX_THRESHOLD))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
    .map(({ id, publicId, similarity, status }) => ({ id, publicId, similarity, status }));
}

/**
 * The k most similar human-reviewed requests, with their outcomes.
 *
 * "Human-reviewed" = interpretedScope is set (a coordinator accepted or
 * edited a triage — an untriaged request has nothing to teach a triage
 * prompt). Closed requests rank above open ones at equal similarity: a
 * finished lifecycle is a whole lesson, an open one only half.
 */
export async function findResolvedPrecedents(
  deps: ServiceDeps,
  input: { agencyId: string; text: string; excludeRequestId?: string; k?: number },
  embedder: EmbeddingProvider = getEmbeddingProvider(),
): Promise<ResolvedPrecedent[]> {
  const k = input.k ?? 4;
  const { repo } = deps;

  const all = await repo.listRequests(input.agencyId);
  const candidates = all.filter(
    (r) => r.id !== input.excludeRequestId && r.interpretedScope != null,
  );
  if (candidates.length === 0) return [];

  // Vector half: stored ask vectors + one embed call for the query text.
  const stored = new Map(
    (await repo.listRequestEmbeddings(input.agencyId)).map((e) => [e.id, e.embedding] as const),
  );
  let queryVec: number[] | null = null;
  if (stored.size > 0) {
    try {
      queryVec = (await embedder.embed([input.text.slice(0, 4000)]))[0] ?? null;
    } catch (e) {
      console.error("[similarRequests] query embed failed — lexical only", e);
    }
  }

  const queryTokens = tokens(input.text);
  const scored = candidates
    .map((r) => {
      const vec = queryVec ? stored.get(r.id) : undefined;
      const similarity = vec
        ? cosine(queryVec!, vec)
        : overlap(queryTokens, tokens(requestEmbeddingText(r)));
      return { r, similarity };
    })
    .filter((s) => s.similarity > 0.1) // noise floor — an unrelated precedent teaches wrong lessons
    .sort(
      (a, b) =>
        b.similarity - a.similarity ||
        Number(b.r.closedAt != null) - Number(a.r.closedAt != null),
    )
    .slice(0, k);

  const deptName = new Map(
    (await repo.listDepartments(input.agencyId)).map((d) => [d.id, d.name] as const),
  );
  return Promise.all(
    scored.map(async ({ r, similarity }) => {
      const tasks = await repo.listTasks(input.agencyId, r.id);
      return {
        publicId: r.publicId,
        ask: r.rawText.trim().slice(0, ASK_SNIPPET),
        interpretedScope: r.interpretedScope!,
        recordTypes: r.recordTypes,
        departments: [
          ...new Set(
            tasks
              .map((t) => (t.departmentId ? deptName.get(t.departmentId) : undefined))
              .filter((n): n is string => !!n),
          ),
        ],
        outcome: r.closedAt != null ? "closed" : r.status,
        complexityScore: r.complexityScore,
        similarity,
      };
    }),
  );
}
