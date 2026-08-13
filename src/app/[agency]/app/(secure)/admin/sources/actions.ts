"use server";

/**
 * Connected data sources admin actions (docs/connected-sources.md phase 1).
 * Register / sync-now / pause / resume / delete — every one an audited,
 * named-actor act through connectedSourceService. Sync-now runs inline (a
 * file-drop pull is small) and enqueues the same follow-up jobs the nightly
 * sweep's durable job does.
 */
import { revalidatePath } from "next/cache";
import { getBlobStore } from "@/adapters/blobStore";
import { getVirusScanner } from "@/adapters/virusScan";
import { staffAction } from "@/auth/actionWrapper";
import {
  deleteConnectedSource,
  registerConnectedSource,
  setConnectedSourceSchedule,
  syncConnectedSource,
  type SyncResult,
} from "@/services/connectedSourceService";

export const registerConnectedSourceAction = staffAction(
  { roles: ["admin"], fallback: "Could not register the source.", exposes: [Error] },
  async ({ staff, deps, agencySlug }, name: string): Promise<{ ok: true; dropDir: string }> => {
    const { dropDir } = await registerConnectedSource(deps, {
      agencyId: staff.agencyId,
      actorUserId: staff.userId,
      name,
    });
    revalidatePath(`/${agencySlug}/app/admin/sources`);
    return { ok: true, dropDir };
  },
);

export const syncConnectedSourceNowAction = staffAction(
  { roles: ["admin"], fallback: "Sync failed — see the source's status for details." },
  async ({ staff, deps, agencySlug }, sourceId: string): Promise<{ ok: true; result: SyncResult }> => {
    const result = await syncConnectedSource(
      { ...deps, blobStore: getBlobStore(), virusScanner: getVirusScanner() },
      {
        agencyId: staff.agencyId,
        sourceId,
        actorLabel: staff.name ?? staff.email ?? "Staff",
      },
    );
    const { getJobQueue } = await import("@/jobs/queue");
    if (result.createdIds.length > 0) {
      getJobQueue().enqueue("classify_documents", {
        agencyId: staff.agencyId,
        documentIds: result.createdIds,
      });
    }
    for (const documentId of result.touchedIds) {
      getJobQueue().enqueue("embed_document_chunks", { agencyId: staff.agencyId, documentId });
    }
    revalidatePath(`/${agencySlug}/app/admin/sources`);
    revalidatePath(`/${agencySlug}/app/records`);
    return { ok: true, result };
  },
);

export const setConnectedSourcePausedAction = staffAction(
  { roles: ["admin"], fallback: "Could not update the source." },
  async ({ staff, deps, agencySlug }, input: { sourceId: string; paused: boolean }): Promise<{ ok: true }> => {
    await setConnectedSourceSchedule(deps, {
      agencyId: staff.agencyId,
      actorUserId: staff.userId,
      sourceId: input.sourceId,
      paused: input.paused,
    });
    revalidatePath(`/${agencySlug}/app/admin/sources`);
    return { ok: true };
  },
);

export const deleteConnectedSourceAction = staffAction(
  { roles: ["admin"], fallback: "Could not delete the source." },
  async ({ staff, deps, agencySlug }, sourceId: string): Promise<{ ok: true }> => {
    await deleteConnectedSource(deps, {
      agencyId: staff.agencyId,
      actorUserId: staff.userId,
      sourceId,
    });
    revalidatePath(`/${agencySlug}/app/admin/sources`);
    return { ok: true };
  },
);
