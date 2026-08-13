/**
 * Connected data sources, phase 1 (docs/connected-sources.md): a registered
 * source is pulled on a schedule and its dataset slices become ORDINARY
 * documents — born internal, PII-scanned, idempotent per (source, dataset,
 * period) — waiting in the publication queue for a named human publish
 * (reviewed mode; standing-publication is phase 2 and NOT built here).
 *
 * The sync path deliberately avoids upsertDocumentByExternalId for updates:
 * that method overwrites classification and metadata wholesale, which would
 * silently UNPUBLISH an already-published slice on re-sync and destroy its
 * decision history. Instead the loop diffs by checksum and, when content
 * really changed, writes an update that carries the EXISTING classification
 * and the MERGED metadata forward. A published slice that changes at the
 * source keeps serving — fresher bytes under the same human decision, the
 * same shape as a trusted re-push in the ingestion API — and the stamp's
 * syncedAt tells the requester how fresh what they see is.
 */
import type { DataSourceConnector } from "@/adapters/dataSource";
import {
  CONNECTOR_KIND_FILE_DROP,
  connectedDropDir,
  createFileDropConnector,
} from "@/adapters/dataSource";
import { blobKey, checksumOf, type BlobStore } from "@/adapters/blobStore";
import { assertUploadable, type VirusScanner } from "@/adapters/virusScan";
import { scanPii, summarizePii } from "@/ai/redaction/piiScan";
import { patchDocumentMeta, readDocumentMeta, type DocumentMeta } from "@/domain/documentMeta";
import type { ServiceDeps } from "./deps";
import { NotFoundError, type DocumentEntity, type SourceEntity } from "./repository";

export type ConnectedDeps = ServiceDeps & { blobStore: BlobStore; virusScanner: VirusScanner };

/** A source is CONNECTED iff it carries a connector kind. */
export function isConnectedSource(s: SourceEntity): boolean {
  return s.connectorKind != null;
}

export async function listConnectedSources(deps: ServiceDeps, agencyId: string): Promise<SourceEntity[]> {
  return (await deps.repo.listSources(agencyId)).filter(isConnectedSource);
}

async function getConnectedSource(deps: ServiceDeps, agencyId: string, sourceId: string): Promise<SourceEntity> {
  const source = (await deps.repo.listSources(agencyId)).find((s) => s.id === sourceId);
  if (!source || !isConnectedSource(source)) throw new NotFoundError("Source", sourceId);
  return source;
}

function connectorFor(source: SourceEntity): DataSourceConnector {
  // Phase 1: file drop only. The drop directory is DERIVED from the agency,
  // never stored or typed — see the tenancy note in adapters/dataSource.ts.
  if (source.connectorKind !== CONNECTOR_KIND_FILE_DROP) {
    throw new Error(`Unknown connector kind "${source.connectorKind}"`);
  }
  return createFileDropConnector(source.agencyId);
}

/**
 * Register a file-drop connected source. Named-actor act, audited. The
 * caller gets the source plus the drop directory to show the admin.
 */
export async function registerConnectedSource(
  deps: ServiceDeps,
  input: { agencyId: string; actorUserId: string; name: string },
): Promise<{ source: SourceEntity; dropDir: string }> {
  const { repo } = deps;
  const actor = await repo.getUser(input.agencyId, input.actorUserId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);
  const name = input.name.trim();
  if (!name) throw new Error("A source needs a name.");

  const source = await repo.createSource({
    id: deps.genId(),
    agencyId: input.agencyId,
    name,
    type: "file_drop",
    apiKeyHash: null,
    // Reviewed mode: everything a sync lands waits for a named human in the
    // publication queue. auto_publish is the phase-2 standing-attestation
    // door and stays closed here.
    trust: "review_queue",
    defaultClassification: "internal",
    connectorKind: CONNECTOR_KIND_FILE_DROP,
    syncSchedule: "nightly",
    lastSyncStatus: "never",
  });
  await repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "connected_source_registered",
    actorLabel: actor.name ?? actor.email,
    summary: `Registered connected data source "${name}" (file drop, reviewed mode)`,
    payload: { sourceId: source.id, connectorKind: CONNECTOR_KIND_FILE_DROP },
    createdAt: deps.now(),
  });
  return { source, dropDir: connectedDropDir(input.agencyId) };
}

/** Pause (schedule null) or resume ("nightly") future syncs. Audited. */
export async function setConnectedSourceSchedule(
  deps: ServiceDeps,
  input: { agencyId: string; actorUserId: string; sourceId: string; paused: boolean },
): Promise<SourceEntity> {
  const { repo } = deps;
  const actor = await repo.getUser(input.agencyId, input.actorUserId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);
  const source = await getConnectedSource(deps, input.agencyId, input.sourceId);
  const updated = await repo.updateSource(input.agencyId, source.id, {
    syncSchedule: input.paused ? null : "nightly",
  });
  await repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "connected_source_updated",
    actorLabel: actor.name ?? actor.email,
    summary: `${input.paused ? "Paused" : "Resumed"} syncing for connected source "${source.name}"`,
    payload: { sourceId: source.id, paused: input.paused },
    createdAt: deps.now(),
  });
  return updated;
}

/**
 * Delete a registration. The corpus and the archive are untouched — synced
 * documents survive with their source detached (port guarantee).
 */
export async function deleteConnectedSource(
  deps: ServiceDeps,
  input: { agencyId: string; actorUserId: string; sourceId: string },
): Promise<void> {
  const { repo } = deps;
  const actor = await repo.getUser(input.agencyId, input.actorUserId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);
  const source = await getConnectedSource(deps, input.agencyId, input.sourceId);
  await repo.deleteSource(input.agencyId, source.id);
  await repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "connected_source_deleted",
    actorLabel: actor.name ?? actor.email,
    summary: `Deleted connected source "${source.name}" — already-synced records stay in the corpus`,
    payload: { sourceId: source.id },
    createdAt: deps.now(),
  });
}

export interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  refused: { filename: string; reason: string }[];
  datasets: string[];
  /** For the caller to enqueue follow-up jobs (services stay queue-free). */
  createdIds: string[];
  touchedIds: string[];
}

function titleFor(dataset: string, period: string): string {
  const pretty = dataset.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return `${pretty} — ${period}`;
}

/**
 * Pull every slice the connector offers and land the changed ones as
 * documents. Never touches classification on existing rows; never deletes
 * (a slice withdrawn at the source stays in the corpus — records offices
 * keep records). Item-granular fail-closed, like every ingest path: an
 * infected or unreadable slice is refused and reported, the rest land.
 */
export async function syncConnectedSource(
  deps: ConnectedDeps,
  input: { agencyId: string; sourceId: string; actorLabel?: string },
  connectorOverride?: DataSourceConnector,
): Promise<SyncResult> {
  const { repo } = deps;
  const source = await getConnectedSource(deps, input.agencyId, input.sourceId);
  const connector = connectorOverride ?? connectorFor(source);

  await repo.updateSource(input.agencyId, source.id, { lastSyncStatus: "running" });

  const result: SyncResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    refused: [],
    datasets: [],
    createdIds: [],
    touchedIds: [],
  };
  try {
    const existingDocs = (await repo.listDocuments(input.agencyId)).filter(
      (d) => d.sourceId === source.id,
    );
    const byExternalId = new Map(existingDocs.map((d) => [d.externalSystemId, d] as const));

    const datasets = await connector.listDatasets();
    result.datasets = datasets.map((d) => d.dataset);

    for (const { dataset, periods } of datasets) {
      for (const period of periods) {
        const externalSystemId = `${dataset}:${period}`;
        try {
          const slice = await connector.fetchSlice(dataset, period);
          if (!slice) continue;

          const checksum = checksumOf(slice.csv);
          const existing = byExternalId.get(externalSystemId);
          if (existing?.checksum === checksum) {
            result.unchanged++;
            continue;
          }

          // Same rule as every other byte path: nothing enters unscanned.
          const scan = await assertUploadable(deps.virusScanner, slice.csv, slice.filename);
          if (!scan.ok) {
            result.refused.push({ filename: slice.filename, reason: scan.reason });
            continue;
          }

          const csvText = slice.csv.toString("utf8");
          const findings = scanPii(csvText);
          const stamp = {
            sourceId: source.id,
            sourceName: source.name,
            dataset,
            period,
            checksum,
            syncedAt: deps.now().toISOString(),
          };
          const freshMeta: Partial<DocumentMeta> = {
            title: titleFor(dataset, period),
            recordDate: slice.recordDate,
            connectedSource: stamp,
            ...(findings.length > 0 ? { sensitivity: summarizePii(findings) } : {}),
          };
          const blobRef = await deps.blobStore.put(
            blobKey(input.agencyId, slice.filename),
            slice.csv,
            "text/csv",
          );

          const doc: DocumentEntity = {
            id: existing?.id ?? deps.genId(),
            agencyId: input.agencyId,
            sourceId: source.id,
            externalSystemId,
            provenance: "connector",
            filename: slice.filename,
            mimeType: "text/csv",
            byteSize: slice.csv.length,
            checksum,
            blobRef,
            extractedText: csvText,
            // A changed slice keeps its human decision (see module comment);
            // a new slice is born internal — reviewed mode, always.
            classification: existing?.classification ?? "internal",
            recordType: "dataset",
            processingStatus: "ready",
            metadata: existing
              ? patchDocumentMeta(existing, {
                  ...freshMeta,
                  // A stale sensitivity tally must not survive a clean re-sync.
                  sensitivity: findings.length > 0 ? summarizePii(findings) : undefined,
                })
              : (freshMeta as DocumentMeta as Record<string, unknown>),
            createdAt: existing?.createdAt ?? deps.now(),
          };
          const { document, created } = await repo.upsertDocumentByExternalId(doc);
          result.touchedIds.push(document.id);
          if (created) {
            result.createdIds.push(document.id);
            result.created++;
          } else {
            result.updated++;
          }
        } catch (e) {
          result.refused.push({
            filename: `${dataset}.${period}.csv`,
            reason: e instanceof Error ? e.message : "Sync failed for this slice.",
          });
        }
      }
    }

    await repo.updateSource(input.agencyId, source.id, {
      lastSyncAt: deps.now(),
      lastSyncStatus: "ok",
      lastSyncError:
        result.refused.length > 0
          ? `${result.refused.length} slice(s) refused: ${result.refused[0]!.reason}`
          : null,
    });
  } catch (e) {
    await repo.updateSource(input.agencyId, source.id, {
      lastSyncAt: deps.now(),
      lastSyncStatus: "error",
      lastSyncError: e instanceof Error ? e.message : "Sync failed.",
    });
    throw e;
  }

  // One event per sync that changed anything (a quiet nightly no-op sync
  // would otherwise write 365 identical rows a year into the admin log).
  if (result.created + result.updated + result.refused.length > 0) {
    await repo.appendAdminEvent({
      id: deps.genId(),
      agencyId: input.agencyId,
      kind: "connected_source_synced",
      actorLabel: input.actorLabel ?? "Scheduled sync",
      summary: `Synced "${source.name}": ${result.created} new, ${result.updated} updated, ${result.unchanged} unchanged${
        result.refused.length ? `, ${result.refused.length} refused` : ""
      } — new records await review`,
      payload: {
        sourceId: source.id,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        datasets: result.datasets,
        refused: result.refused.slice(0, 20),
      },
      createdAt: deps.now(),
    });
  }

  return result;
}

/** The queue-facing sync summary the admin page renders per source. */
export function describeSyncState(s: SourceEntity): string {
  if (s.syncSchedule == null) return "Paused";
  switch (s.lastSyncStatus ?? "never") {
    case "never":
      return "Never synced";
    case "running":
      return "Sync running…";
    case "error":
      return `Sync failed${s.lastSyncError ? ` — ${s.lastSyncError}` : ""}`;
    default:
      return s.lastSyncError ? `Synced, with refusals — ${s.lastSyncError}` : "Synced";
  }
}

/** Read a document's connected-source stamp, if it is a dataset slice. */
export function connectedStampOf(doc: Pick<DocumentEntity, "metadata">) {
  return readDocumentMeta(doc).connectedSource ?? null;
}
