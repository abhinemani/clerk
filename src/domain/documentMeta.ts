/**
 * The ONE definition of what lives in `documents.metadata` (jsonb). Every
 * writer in the codebase stamps keys here — the importer (title/tags/dates),
 * the publication service (publicationDecision, releasedOn), the AI jobs
 * (aiClassification, aiSuggestions), the ingest normalizer (sensitivity,
 * deepLink), release auto-publish (releaseId). Before this module, every
 * reader re-declared its own partial cast; now the shape is written down
 * once and validated.
 *
 * Two deliberate properties:
 *  - `.passthrough()` — unknown keys survive read-modify-write cycles.
 *    Connectors and future features add keys; a reader that stripped them
 *    would corrupt data it never knew existed.
 *  - Reads NEVER throw. A malformed legacy row renders as an untitled
 *    record; it must not 500 the queue or the archive. `readDocumentMeta`
 *    falls back per-field, not per-document, so one bad key doesn't blank
 *    the rest.
 */
import { z } from "zod";
import type { DocumentEntity } from "@/services/repository";

/** A publish / keep-internal / unpublish decision (cache of the audit row). */
export const publicationDecisionSchema = z
  .object({
    decision: z.enum(["published", "internal"]),
    byUserId: z.string(),
    byName: z.string(),
    at: z.string(),
    /** Present when the decision is an UNPUBLISH — the stated justification. */
    reason: z.string().optional(),
  })
  .passthrough();
export type PublicationDecision = z.infer<typeof publicationDecisionSchema>;

/** AI classification hint (classify_documents job) — a suggestion, never an act. */
export const aiClassificationSchema = z
  .object({
    recordType: z.string().optional(),
    department: z.string().nullable().optional(),
    suggestedClassification: z.enum(["public", "internal"]).optional(),
    suggestedMetadata: z.array(z.object({ key: z.string(), value: z.string() }).passthrough()).optional(),
    sensitivityNote: z.string().nullable().optional(),
  })
  .passthrough();
export type AiClassificationHint = z.infer<typeof aiClassificationSchema>;

export const documentMetaSchema = z
  .object({
    // Archive card fields (portal-facing once published).
    title: z.string().optional(),
    summary: z.string().optional(),
    tags: z.array(z.string()).optional(),
    keywords: z.array(z.string()).optional(),
    /** The record's own date (meeting date, report date), YYYY-MM-DD. */
    recordDate: z.string().optional(),
    /** What the archive shows as "Released" — set at publish/release time. */
    releasedOn: z.string().optional(),
    /** Release-born archive entries: which release holds the frozen bytes. */
    releaseId: z.string().optional(),
    /** Deep link back to the system of record (§9.1 ingest payload). */
    deepLink: z.string().optional(),
    /** Burned artifacts: which studio minted them ("text" | "visual"). */
    redactionMode: z.enum(["text", "visual"]).optional(),
    /** Deterministic PII pre-scan tallies: { ssn: 2, phone: 5, … } (§6.5). */
    sensitivity: z.record(z.number()).optional(),
    publicationDecision: publicationDecisionSchema.optional(),
    aiClassification: aiClassificationSchema.optional(),
    /**
     * ASK ALIASES — the plain-language questions this record has actually
     * answered (docs/answer-first.md). Appended when a request that this
     * document satisfied is fulfilled, so the archive slowly learns the
     * public's vocabulary instead of only the government's filing language:
     * a resident asks for "the police video from the parade", the agency
     * filed it as "Axon Body 3 export, Incident 2025-0714-A".
     *
     * These are written for EVERY attached document, public or not. Exposure
     * is not this field's job — requester-facing retrieval is hard-scoped to
     * classification='public' at the query layer (invariant 3), so a private
     * document's aliases are unreachable until a named human publishes it,
     * and then its history comes with it.
     */
    askedAs: z.array(z.string()).optional(),
  })
  .passthrough();

export type DocumentMeta = z.infer<typeof documentMetaSchema>;

/**
 * Read a document's metadata, tolerantly. Per-field salvage: if the whole
 * object fails validation, each known key is retried alone so one malformed
 * value (say, a string where tags should be) doesn't blank the title too.
 */
export function readDocumentMeta(doc: Pick<DocumentEntity, "metadata">): DocumentMeta {
  const raw = doc.metadata ?? {};
  const parsed = documentMetaSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const salvaged: Record<string, unknown> = { ...raw };
  for (const key of Object.keys(documentMetaSchema.shape) as (keyof typeof documentMetaSchema.shape)[]) {
    if (!(key in salvaged)) continue;
    const one = documentMetaSchema.shape[key].safeParse(salvaged[key]);
    if (!one.success) delete salvaged[key];
  }
  const retry = documentMetaSchema.safeParse(salvaged);
  return retry.success ? retry.data : {};
}

/**
 * Merge a patch into a document's metadata for an updateDocument call.
 * Preserves unknown keys (read-modify-write is the ONLY safe write shape for
 * this column — never write a fresh object over it).
 */
export function patchDocumentMeta(
  doc: Pick<DocumentEntity, "metadata">,
  patch: Partial<DocumentMeta>,
): Record<string, unknown> {
  return { ...(doc.metadata ?? {}), ...patch };
}

/** High-confidence PII tally for a queue-row warning chip, or null if clean. */
export function sensitivitySummary(meta: DocumentMeta): string | null {
  const s = meta.sensitivity;
  if (!s) return null;
  const parts = Object.entries(s)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${type.replace(/_/g, " ")} ×${count}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Alias cap per document — enough to teach the index, bounded so a hot
 *  record can't grow an unbounded metadata blob. Oldest fall off first. */
export const MAX_ASK_ALIASES = 25;

/**
 * Add a question this document answered, de-duplicated case-insensitively so
 * ten residents asking the same thing leave one alias, not ten. Returns the
 * new list, or null when there is nothing to add (empty/too short/duplicate)
 * so callers can skip the write entirely.
 */
export function addAskAlias(meta: DocumentMeta, ask: string): string[] | null {
  const clean = ask.replace(/\s+/g, " ").trim();
  if (clean.length < 8) return null; // "records" teaches nothing
  const existing = meta.askedAs ?? [];
  const seen = new Set(existing.map((a) => a.toLowerCase()));
  if (seen.has(clean.toLowerCase())) return null;
  return [...existing, clean].slice(-MAX_ASK_ALIASES);
}
