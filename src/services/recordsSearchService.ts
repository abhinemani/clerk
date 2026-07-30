/**
 * Staff responsive-records search (spec §6.4) — the daily job is FINDING
 * records; this turns the corpus into fulfillment leverage.
 *
 * STAFF SURFACES ONLY: searches the full corpus (public + internal) via the
 * same LexicalRetriever the answer engine uses, at scope "full". Requester
 * surfaces must never call this — they have the public-only archive search
 * (invariant 3 lives in that query layer, not here).
 *
 * Self-contained: lexical scoring over filename + extracted text + metadata
 * works with zero configuration. (Per-chunk embeddings are the planned
 * upgrade behind the same signature — see HANDOFF roadmap.)
 */
import { LexicalRetriever } from "@/ai/search/retriever";
import type { CorpusDoc } from "@/lib/corpus";
import type { ServiceDeps } from "./deps";
import { NotFoundError, type DocumentEntity } from "./repository";

export interface RecordsSearchHit {
  documentId: string;
  filename: string;
  classification: "public" | "internal";
  provenance: string;
  recordType: string | null;
  snippet: string;
  whyMatched: string;
  createdAt: Date;
  /** True when the doc is already in the target request's review set. */
  alreadyAttached?: boolean;
}

function toCorpusDoc(d: DocumentEntity): CorpusDoc {
  const meta = d.metadata ?? {};
  const metaText = ["title", "summary", "tags", "keywords"]
    .map((k) => {
      const v = (meta as Record<string, unknown>)[k];
      return Array.isArray(v) ? v.join(" ") : typeof v === "string" ? v : "";
    })
    .join(" ");
  return {
    id: d.id,
    title: d.filename ?? d.id,
    text: `${metaText} ${d.extractedText ?? ""}`.trim(),
    classification: d.classification,
    recordType: d.recordType ?? undefined,
  };
}

export async function searchAgencyRecords(
  deps: Pick<ServiceDeps, "repo">,
  input: { agencyId: string; query: string; limit?: number; forRequestId?: string },
): Promise<RecordsSearchHit[]> {
  const { repo } = deps;
  const docs = (await repo.listDocuments(input.agencyId)).filter(
    // Burned artifacts are release copies, not source records — hide them
    // from fulfillment search (their originals are what get attached).
    (d) => !d.externalSystemId?.startsWith("redacted:"),
  );
  const byId = new Map(docs.map((d) => [d.id, d]));

  const retriever = new LexicalRetriever(docs.map(toCorpusDoc));
  const hits = await retriever.search(input.query, { scope: "full", limit: input.limit ?? 20 });

  const attached = new Set<string>(
    input.forRequestId
      ? (await repo.listRequestDocuments(input.agencyId, input.forRequestId)).map((d) => d.id)
      : [],
  );

  return hits.map((h) => {
    const d = byId.get(h.id)!;
    return {
      documentId: d.id,
      filename: d.filename ?? d.id,
      classification: d.classification,
      provenance: d.provenance ?? "connector",
      recordType: d.recordType ?? null,
      snippet: h.snippet,
      whyMatched: h.whyMatched,
      createdAt: d.createdAt,
      alreadyAttached: attached.has(d.id),
    };
  });
}

/**
 * Attach a found document to a request's review set — the "fulfill from the
 * corpus" move. Logged under the attaching staff member; the exemption pass
 * is re-enqueued by the caller so suggestions cover the new document.
 */
export async function attachDocumentToRequest(
  deps: ServiceDeps,
  input: { agencyId: string; requestId: string; documentId: string; actorUserId: string },
): Promise<void> {
  const { repo } = deps;
  const [request, document, actor] = await Promise.all([
    repo.getRequest(input.agencyId, input.requestId),
    repo.getDocument(input.agencyId, input.documentId),
    repo.getUser(input.agencyId, input.actorUserId),
  ]);
  if (!request) throw new NotFoundError("Request", input.requestId);
  if (!document) throw new NotFoundError("Document", input.documentId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);

  const existing = await repo.listRequestDocuments(input.agencyId, input.requestId);
  if (existing.some((d) => d.id === document.id)) return; // idempotent

  await repo.linkRequestDocument(input.agencyId, input.requestId, document.id);
  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: input.requestId,
    kind: "note",
    actorUserId: input.actorUserId,
    summary: `${actor.name ?? actor.email} attached ${document.filename ?? document.id} from records search`,
    payload: { documentId: document.id, source: "records_search" },
    createdAt: deps.now(),
  });
}
