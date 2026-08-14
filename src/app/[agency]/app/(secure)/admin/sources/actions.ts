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
import type { ConnectorConfig } from "@/adapters/dataSource";
import { staffAction } from "@/auth/actionWrapper";
import {
  attestDataset,
  deleteConnectedSource,
  registerConnectedSource,
  revokeDatasetAttestation,
  setConnectedSourceSchedule,
  syncConnectedSource,
  type SyncResult,
} from "@/services/connectedSourceService";

export const registerConnectedSourceAction = staffAction(
  { roles: ["admin"], fallback: "Could not register the source.", exposes: [Error] },
  async (
    { staff, deps, agencySlug },
    input: { name: string; kind: string; config: ConnectorConfig },
  ): Promise<{ ok: true; dropDir: string }> => {
    const { dropDir } = await registerConnectedSource(deps, {
      agencyId: staff.agencyId,
      actorUserId: staff.userId,
      name: input.name,
      kind: input.kind,
      config: input.config,
    });
    revalidatePath(`/${agencySlug}/app/admin/data`);
    return { ok: true, dropDir };
  },
);

/**
 * Standing publication, on and off. Both are named-actor acts through the
 * service (which re-checks the admin role and the attested column shape) —
 * the action layer only carries the session identity in.
 */
export const attestDatasetAction = staffAction(
  { roles: ["admin"], fallback: "Could not turn on standing publication.", exposes: [Error] },
  async ({ staff, deps, agencySlug }, input: { sourceId: string; dataset: string }): Promise<{ ok: true; byName: string }> => {
    const attestation = await attestDataset(deps, {
      agencyId: staff.agencyId,
      actorUserId: staff.userId,
      sourceId: input.sourceId,
      dataset: input.dataset,
    });
    revalidatePath(`/${agencySlug}/app/admin/data`);
    return { ok: true, byName: attestation.byName };
  },
);

export const revokeAttestationAction = staffAction(
  { roles: ["admin"], fallback: "Could not turn off standing publication.", exposes: [Error] },
  async ({ staff, deps, agencySlug }, input: { sourceId: string; dataset: string }): Promise<{ ok: true }> => {
    await revokeDatasetAttestation(deps, {
      agencyId: staff.agencyId,
      actorUserId: staff.userId,
      sourceId: input.sourceId,
      dataset: input.dataset,
    });
    revalidatePath(`/${agencySlug}/app/admin/data`);
    return { ok: true };
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
    revalidatePath(`/${agencySlug}/app/admin/data`);
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
    revalidatePath(`/${agencySlug}/app/admin/data`);
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
    revalidatePath(`/${agencySlug}/app/admin/data`);
    return { ok: true };
  },
);
