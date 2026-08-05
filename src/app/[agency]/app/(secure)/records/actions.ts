"use server";

/**
 * Publication-queue actions (docs/records-ingestion.md §2). Bulk selections
 * loop through the service PER DOCUMENT — every publish/keep is its own
 * named-actor admin event (invariant 4); there is no batch write that could
 * blur who published what.
 */
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { defaultDeps } from "@/services/deps";
import {
  keepDocumentInternal,
  publishDocument,
  PublicationError,
  unpublishDocument,
} from "@/services/publicationService";

export interface PublishItem {
  documentId: string;
  /** Archive metadata overrides; blank fields fall back to the imported values. */
  title?: string;
  summary?: string;
  /** Comma/semicolon-separated. */
  tags?: string;
  keywords?: string;
}

export interface PerDocResult {
  documentId: string;
  ok: boolean;
  error?: string;
}

function splitList(raw: string | undefined): string[] | undefined {
  if (raw == null || !raw.trim()) return undefined;
  return raw
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
}

const MAX_BATCH = 200;

export async function publishRecordsAction(
  agencySlug: string,
  items: PublishItem[],
): Promise<{ ok: true; results: PerDocResult[] } | { ok: false; error: string }> {
  const staff = await requireStaff(agencySlug); // coordinator+ — responders never decide publication
  if (items.length === 0) return { ok: false, error: "Nothing selected." };
  if (items.length > MAX_BATCH) return { ok: false, error: `At most ${MAX_BATCH} records per batch.` };

  const repo = await getRepository();
  const deps = defaultDeps(repo);
  const results: PerDocResult[] = [];
  for (const item of items) {
    try {
      await publishDocument(deps, {
        agencyId: staff.agencyId,
        actorUserId: staff.userId,
        documentId: item.documentId,
        archiveMeta: {
          title: item.title,
          summary: item.summary,
          tags: splitList(item.tags),
          keywords: splitList(item.keywords),
        },
      });
      results.push({ documentId: item.documentId, ok: true });
    } catch (e) {
      results.push({
        documentId: item.documentId,
        ok: false,
        error: e instanceof PublicationError ? e.message : "Could not publish this record.",
      });
      if (!(e instanceof PublicationError)) console.error("publishDocument failed", e);
    }
  }

  if (results.some((r) => r.ok)) {
    // The archive grew — refresh its search vectors off the request path.
    const { getJobQueue } = await import("@/jobs/queue");
    getJobQueue().enqueue("embed_public_documents", { agencyId: staff.agencyId });
  }

  revalidatePath(`/${agencySlug}/app/records`);
  revalidatePath(`/${agencySlug}/archive`);
  return { ok: true, results };
}

/**
 * Emergency takedown — deliberately per-record (no bulk): each unpublish is a
 * named, reasoned act. The record leaves every public surface immediately
 * (retrieval is query-scoped to classification='public').
 */
export async function unpublishRecordAction(
  agencySlug: string,
  documentId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const staff = await requireStaff(agencySlug);
  try {
    const repo = await getRepository();
    await unpublishDocument(defaultDeps(repo), {
      agencyId: staff.agencyId,
      actorUserId: staff.userId,
      documentId,
      reason,
    });
    revalidatePath(`/${agencySlug}/app/records`);
    revalidatePath(`/${agencySlug}/archive`);
    return { ok: true };
  } catch (e) {
    if (e instanceof PublicationError) return { ok: false, error: e.message };
    console.error("unpublishDocument failed", e);
    return { ok: false, error: "Could not unpublish the record." };
  }
}

export async function keepInternalRecordsAction(
  agencySlug: string,
  documentIds: string[],
): Promise<{ ok: true; results: PerDocResult[] } | { ok: false; error: string }> {
  const staff = await requireStaff(agencySlug);
  if (documentIds.length === 0) return { ok: false, error: "Nothing selected." };
  if (documentIds.length > MAX_BATCH) return { ok: false, error: `At most ${MAX_BATCH} records per batch.` };

  const repo = await getRepository();
  const deps = defaultDeps(repo);
  const results: PerDocResult[] = [];
  for (const documentId of documentIds) {
    try {
      await keepDocumentInternal(deps, { agencyId: staff.agencyId, actorUserId: staff.userId, documentId });
      results.push({ documentId, ok: true });
    } catch (e) {
      results.push({
        documentId,
        ok: false,
        error: e instanceof PublicationError ? e.message : "Could not record the decision.",
      });
      if (!(e instanceof PublicationError)) console.error("keepDocumentInternal failed", e);
    }
  }

  revalidatePath(`/${agencySlug}/app/records`);
  return { ok: true, results };
}
