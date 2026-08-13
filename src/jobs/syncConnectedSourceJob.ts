/**
 * Connected-source sync (docs/connected-sources.md): pull a source's dataset
 * slices into the corpus. Enqueued by the admin "Sync now" action and by the
 * nightly sweep for every enabled connected source. New slices land INTERNAL
 * in the publication queue (reviewed mode); follow-up jobs give the queue AI
 * hints and keep staff-search vectors fresh.
 */
import { getBlobStore } from "@/adapters/blobStore";
import { getVirusScanner } from "@/adapters/virusScan";
import { getRepository } from "@/db/createRepository";
import { syncConnectedSource } from "@/services/connectedSourceService";
import { defaultDeps } from "@/services/deps";
import { getJobQueue } from "./queue";
import type { JobPayloads } from "./queue";

export async function runSyncConnectedSourceJob(
  payload: JobPayloads["sync_connected_source"],
): Promise<void> {
  const repo = await getRepository();
  const deps = {
    ...defaultDeps(repo),
    blobStore: getBlobStore(),
    virusScanner: getVirusScanner(),
  };
  const result = await syncConnectedSource(deps, {
    agencyId: payload.agencyId,
    sourceId: payload.sourceId,
    actorLabel: payload.actorLabel,
  });

  const queue = getJobQueue();
  if (result.createdIds.length > 0) {
    queue.enqueue("classify_documents", {
      agencyId: payload.agencyId,
      documentIds: result.createdIds,
    });
  }
  for (const documentId of result.touchedIds) {
    queue.enqueue("embed_document_chunks", { agencyId: payload.agencyId, documentId });
  }
}
