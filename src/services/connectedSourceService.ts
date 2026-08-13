/**
 * Connected data sources (docs/connected-sources.md), phases 1–2: a
 * registered source is pulled on a schedule and its dataset slices become
 * ORDINARY documents — PII-scanned, idempotent per (source, dataset,
 * period) — landing in the publication queue for a named human.
 *
 * TWO PUBLICATION MODES, and the difference is one attestation:
 *  - REVIEWED (default): every slice waits for a per-slice human publish.
 *  - STANDING (phase 2, opt-in per dataset): a named admin attested "this
 *    dataset is public data; publish future slices automatically", and the
 *    sync repeats that recorded decision for new periods of the same data.
 *
 * The standing mode's four rails are non-negotiable parts of the feature,
 * and they live in `classifyNewSlice` below:
 *  1. Every auto-published slice cites the attestation (who, when) in its
 *     publicationDecision and in an admin event — the audit trail always
 *     reaches a named human.
 *  2. A slice whose PII scan finds anything quarantines to internal
 *     regardless of mode.
 *  3. Schema drift quarantines AND revokes: an attestation covers the data
 *     shape the human looked at, not whatever the source sends later.
 *  4. FUTURE SLICES ONLY. A standing attestation can make a NEW slice be
 *     born public; nothing here ever flips an EXISTING internal document to
 *     public. That direction is exactly what invariant 9 forbids without a
 *     named human act, so slices that landed before the attestation still
 *     need a per-slice publish.
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
import type { ConnectorConfig, DataSourceConnector, DatasetSlice } from "@/adapters/dataSource";
import {
  CONNECTOR_KIND_FILE_DROP,
  connectedDropDir,
  createConnector,
  validateConnectorConfig,
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

/* ---- source config + per-dataset attestations ------------------------------
 *
 * Both live in `sources.mappingConfig`. The connector half is operator
 * config (validated at write time, never trusted at read time); the
 * attestation half is the record of a named human's standing decision.
 */

export interface DatasetAttestation {
  byUserId: string;
  byName: string;
  at: string;
  /** The column shape the human attested to — rail 3 compares against it. */
  columns: string[];
}

interface SourceConfig {
  connector: ConnectorConfig;
  attestations: Record<string, DatasetAttestation>;
}

export function readSourceConfig(source: SourceEntity): SourceConfig {
  const raw = (source.mappingConfig ?? {}) as Partial<SourceConfig>;
  const connector = (raw.connector ?? {}) as ConnectorConfig;
  const attestations: Record<string, DatasetAttestation> = {};
  for (const [dataset, a] of Object.entries(raw.attestations ?? {})) {
    // Tolerant read: a malformed attestation is treated as ABSENT, which
    // fails safe (reviewed mode) rather than auto-publishing on junk.
    if (a && typeof a === "object" && typeof a.byUserId === "string" && Array.isArray(a.columns)) {
      attestations[dataset] = {
        byUserId: a.byUserId,
        byName: String(a.byName ?? "Unknown"),
        at: String(a.at ?? ""),
        columns: a.columns.map(String),
      };
    }
  }
  return { connector, attestations };
}

function connectorFor(source: SourceEntity): DataSourceConnector {
  const { connector } = readSourceConfig(source);
  // The file drop's directory is DERIVED from the agency, never stored or
  // typed — see the tenancy note in adapters/dataSource.ts.
  return createConnector(source.connectorKind ?? CONNECTOR_KIND_FILE_DROP, source.agencyId, connector);
}

/** Same column names in the same order — the drift test (rail 3). */
function sameColumns(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

/**
 * How a NEW slice is born. This is the whole publicness decision in one
 * pure function, so the invariant tests can point at it:
 *
 *  - no live attestation  → internal (reviewed mode: a human publishes)
 *  - PII found            → internal, quarantined (rail 2 — regardless of mode)
 *  - columns drifted      → internal, quarantined + the attestation dies (rail 3)
 *  - otherwise            → public, under the attestation (rail 1 cites it)
 */
export function classifyNewSlice(
  attestation: DatasetAttestation | undefined,
  slice: Pick<DatasetSlice, "columns">,
  piiFindingCount: number,
): { classification: "public" | "internal"; quarantined?: "pii" | "schema_drift"; drift?: boolean } {
  if (!attestation) return { classification: "internal" };
  if (piiFindingCount > 0) return { classification: "internal", quarantined: "pii" };
  if (!sameColumns(attestation.columns, slice.columns)) {
    return { classification: "internal", quarantined: "schema_drift", drift: true };
  }
  return { classification: "public" };
}

/**
 * Register a file-drop connected source. Named-actor act, audited. The
 * caller gets the source plus the drop directory to show the admin.
 */
export async function registerConnectedSource(
  deps: ServiceDeps,
  input: {
    agencyId: string;
    actorUserId: string;
    name: string;
    /** Defaults to the file drop — the zero-service on-ramp. */
    kind?: string;
    config?: ConnectorConfig;
  },
): Promise<{ source: SourceEntity; dropDir: string }> {
  const { repo } = deps;
  const actor = await repo.getUser(input.agencyId, input.actorUserId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);
  const name = input.name.trim();
  if (!name) throw new Error("A source needs a name.");

  const checked = validateConnectorConfig(input.kind ?? CONNECTOR_KIND_FILE_DROP, input.config ?? {});
  if (!checked.ok) throw new Error(checked.reason);

  // ONE file drop per agency. The drop directory is per-AGENCY (it has to
  // be: a clerk needs a path to hand their IT department before any source
  // exists), so a second file-drop source would read the same files and
  // mint a duplicate document for every slice — same bytes, different
  // sourceId, both in the archive. Network sources have their own URLs and
  // are unaffected.
  if (checked.kind === CONNECTOR_KIND_FILE_DROP) {
    const existing = (await repo.listSources(input.agencyId)).find(
      (s) => s.connectorKind === CONNECTOR_KIND_FILE_DROP,
    );
    if (existing) {
      throw new Error(
        `This agency already has a file-drop source ("${existing.name}") reading ${connectedDropDir(input.agencyId)}. Add datasets by dropping more files there, or connect an HTTP/Socrata source instead.`,
      );
    }
  }

  const source = await repo.createSource({
    id: deps.genId(),
    agencyId: input.agencyId,
    name,
    // The schema's source types: a pulled feed is a scheduled_pull, a
    // watched directory is a file_drop.
    type: checked.kind === CONNECTOR_KIND_FILE_DROP ? "file_drop" : "scheduled_pull",
    apiKeyHash: null,
    // Reviewed mode at birth, always: a source becomes standing-publication
    // only when a named admin attests a specific dataset, never at
    // registration time in one click.
    trust: "review_queue",
    defaultClassification: "internal",
    connectorKind: checked.kind,
    syncSchedule: "nightly",
    lastSyncStatus: "never",
    mappingConfig: { connector: checked.config, attestations: {} },
  });
  await repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "connected_source_registered",
    actorLabel: actor.name ?? actor.email,
    summary: `Registered connected data source "${name}" (${checked.kind.replace("dataset_", "")}, reviewed mode)`,
    payload: { sourceId: source.id, connectorKind: checked.kind, config: checked.config },
    createdAt: deps.now(),
  });
  return { source, dropDir: connectedDropDir(input.agencyId) };
}

/**
 * STANDING PUBLICATION (phase 2). A named admin attests that a dataset is
 * public data, so FUTURE slices of it publish without a per-slice click.
 * The attestation records who, when, and the column shape they looked at.
 *
 * `columns` comes from the slices already synced for this dataset — the
 * admin is attesting to data they can see, not to an abstraction. Attesting
 * does NOT publish anything that already landed: existing internal slices
 * still need a named publish (invariant 9 — nothing here reclassifies).
 */
export async function attestDataset(
  deps: ServiceDeps,
  input: { agencyId: string; actorUserId: string; sourceId: string; dataset: string },
): Promise<DatasetAttestation> {
  const { repo } = deps;
  const actor = await repo.getUser(input.agencyId, input.actorUserId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);
  if (actor.role !== "admin") {
    throw new Error("Only an agency admin can put a dataset on standing publication.");
  }
  const source = await getConnectedSource(deps, input.agencyId, input.sourceId);
  const config = readSourceConfig(source);

  // The shape being attested to: the columns of the most recent slice we
  // hold for this dataset. No slices yet = nothing to look at = no
  // attestation, rather than a blank cheque against future columns.
  const docs = (await repo.listDocuments(input.agencyId)).filter((d) => d.sourceId === source.id);
  const slices = docs
    .map((d) => ({ doc: d, stamp: connectedStampOf(d) }))
    .filter((x) => x.stamp?.dataset === input.dataset)
    .sort((a, b) => (a.stamp!.period < b.stamp!.period ? 1 : -1));
  const columns = slices[0]?.stamp?.columns ?? [];
  if (columns.length === 0) {
    throw new Error(
      "Sync this dataset at least once before attesting — you attest to the columns you can see.",
    );
  }

  const attestation: DatasetAttestation = {
    byUserId: actor.id,
    byName: actor.name ?? actor.email,
    at: deps.now().toISOString(),
    columns,
  };
  await repo.updateSource(input.agencyId, source.id, {
    mappingConfig: {
      ...config,
      attestations: { ...config.attestations, [input.dataset]: attestation },
    },
  });
  await repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "connected_dataset_attested",
    actorLabel: attestation.byName,
    summary: `Standing publication ON for "${input.dataset}" (${source.name}) — future slices publish automatically under ${attestation.byName}'s attestation`,
    payload: {
      sourceId: source.id,
      dataset: input.dataset,
      columns,
      attestedBy: attestation.byUserId,
    },
    createdAt: deps.now(),
  });
  return attestation;
}

/** Revoke a standing attestation — the next sync is back to reviewed mode. */
export async function revokeDatasetAttestation(
  deps: ServiceDeps,
  input: { agencyId: string; actorUserId: string; sourceId: string; dataset: string; reason?: string },
): Promise<void> {
  const { repo } = deps;
  const actor = await repo.getUser(input.agencyId, input.actorUserId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);
  const source = await getConnectedSource(deps, input.agencyId, input.sourceId);
  const config = readSourceConfig(source);
  if (!config.attestations[input.dataset]) return;

  const { [input.dataset]: _removed, ...rest } = config.attestations;
  await repo.updateSource(input.agencyId, source.id, {
    mappingConfig: { ...config, attestations: rest },
  });
  await repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "connected_dataset_attestation_revoked",
    actorLabel: actor.name ?? actor.email,
    summary: `Standing publication OFF for "${input.dataset}" (${source.name})${input.reason ? ` — ${input.reason}` : ""}. Already-published slices stay public; new ones wait for review.`,
    payload: { sourceId: source.id, dataset: input.dataset, reason: input.reason ?? null },
    createdAt: deps.now(),
  });
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
  /** Slices born public under a standing attestation (phase 2). */
  autoPublished: number;
  /** Slices an attested dataset held back, and why (rails 2 and 3). */
  quarantined: { dataset: string; period: string; why: "pii" | "schema_drift" }[];
  /** Datasets whose attestation this sync revoked for schema drift. */
  driftRevoked: string[];
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
    autoPublished: 0,
    quarantined: [],
    driftRevoked: [],
  };

  // Attestations are read ONCE per sync and mutated locally: a dataset that
  // drifts mid-sync stops auto-publishing for its remaining slices in the
  // same run, before the revocation is persisted below.
  const liveAttestations = { ...readSourceConfig(source).attestations };
  const driftedDatasets = new Set<string>();

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

          // ---- the standing-publication rails, for NEW slices only ----
          // (rail 4: an existing document's classification is never touched
          // by sync — that direction needs a named human, invariant 9.)
          const attestation = liveAttestations[dataset];
          const verdict = classifyNewSlice(attestation, slice, findings.length);
          if (verdict.drift && attestation) {
            // Rail 3: the shape changed under the attestation. Drop this
            // dataset back to reviewed and tell the office why.
            driftedDatasets.add(dataset);
            delete liveAttestations[dataset];
          }

          const stamp = {
            sourceId: source.id,
            sourceName: source.name,
            dataset,
            period,
            checksum,
            syncedAt: deps.now().toISOString(),
            columns: slice.columns,
            ...(slice.truncated ? { truncated: true } : {}),
            ...(verdict.quarantined ? { quarantined: verdict.quarantined } : {}),
          };
          const freshMeta: Partial<DocumentMeta> = {
            title: titleFor(dataset, period),
            recordDate: slice.recordDate,
            connectedSource: stamp,
            ...(findings.length > 0 ? { sensitivity: summarizePii(findings) } : {}),
            // Rail 1: an auto-published slice carries the attestation as its
            // publication decision, so the record itself names the human.
            ...(verdict.classification === "public" && attestation
              ? {
                  publicationDecision: {
                    decision: "published" as const,
                    byUserId: attestation.byUserId,
                    byName: attestation.byName,
                    at: deps.now().toISOString(),
                    reason: `Standing publication for "${dataset}", attested ${attestation.at.slice(0, 10)}`,
                  },
                }
              : {}),
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
            // a NEW slice is born internal unless a live attestation, a
            // clean PII scan, and a matching column shape all agree.
            classification: existing?.classification ?? verdict.classification,
            recordType: "dataset",
            processingStatus: "ready",
            metadata: existing
              ? patchDocumentMeta(existing, {
                  ...freshMeta,
                  // A stale sensitivity tally must not survive a clean re-sync.
                  sensitivity: findings.length > 0 ? summarizePii(findings) : undefined,
                  // Never let a re-sync stamp a publication decision onto a
                  // document a human decided (or hasn't yet).
                  publicationDecision: readDocumentMeta(existing).publicationDecision,
                })
              : (freshMeta as DocumentMeta as Record<string, unknown>),
            createdAt: existing?.createdAt ?? deps.now(),
          };
          const { document, created } = await repo.upsertDocumentByExternalId(doc);
          result.touchedIds.push(document.id);
          if (created) {
            result.createdIds.push(document.id);
            result.created++;
            if (verdict.classification === "public" && attestation) {
              result.autoPublished++;
              // Rail 1, per record: publishing to the public is one audited
              // event per document — the same rule bulk publish follows.
              await repo.appendAdminEvent({
                id: deps.genId(),
                agencyId: input.agencyId,
                kind: "document_published",
                actorLabel: attestation.byName,
                summary: `Auto-published "${titleFor(dataset, period)}" under the standing attestation for "${dataset}" (${source.name})`,
                payload: {
                  documentId: document.id,
                  sourceId: source.id,
                  dataset,
                  period,
                  attestedBy: attestation.byUserId,
                  attestedAt: attestation.at,
                  automated: true,
                },
                createdAt: deps.now(),
              });
            } else if (verdict.quarantined) {
              result.quarantined.push({ dataset, period, why: verdict.quarantined });
            }
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

    // Rail 3, persisted: a drifted dataset loses its attestation until a
    // human looks at the new shape and re-attests.
    if (driftedDatasets.size > 0) {
      const current = readSourceConfig(source);
      const kept = Object.fromEntries(
        Object.entries(current.attestations).filter(([d]) => !driftedDatasets.has(d)),
      );
      await repo.updateSource(input.agencyId, source.id, {
        mappingConfig: { ...current, attestations: kept },
      });
      result.driftRevoked = [...driftedDatasets];
      for (const dataset of driftedDatasets) {
        await repo.appendAdminEvent({
          id: deps.genId(),
          agencyId: input.agencyId,
          kind: "connected_dataset_attestation_revoked",
          actorLabel: "Scheduled sync",
          summary: `Standing publication OFF for "${dataset}" (${source.name}) — the source's columns changed since it was attested. New slices are waiting for review.`,
          payload: {
            sourceId: source.id,
            dataset,
            reason: "schema_drift",
            attestedColumns: current.attestations[dataset]?.columns ?? [],
          },
          createdAt: deps.now(),
        });
      }
    }

    const notes = [
      result.refused.length > 0
        ? `${result.refused.length} slice(s) refused: ${result.refused[0]!.reason}`
        : null,
      result.quarantined.length > 0
        ? `${result.quarantined.length} slice(s) held for review (${[...new Set(result.quarantined.map((q) => q.why))].join(", ")})`
        : null,
      result.driftRevoked.length > 0
        ? `standing publication revoked for ${result.driftRevoked.join(", ")} (columns changed)`
        : null,
    ].filter(Boolean);
    await repo.updateSource(input.agencyId, source.id, {
      lastSyncAt: deps.now(),
      lastSyncStatus: "ok",
      lastSyncError: notes.length > 0 ? notes.join(" · ") : null,
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
    const tail =
      result.autoPublished > 0
        ? `${result.autoPublished} auto-published under standing attestation, ${result.created - result.autoPublished} awaiting review`
        : "new records await review";
    await repo.appendAdminEvent({
      id: deps.genId(),
      agencyId: input.agencyId,
      kind: "connected_source_synced",
      actorLabel: input.actorLabel ?? "Scheduled sync",
      summary: `Synced "${source.name}": ${result.created} new, ${result.updated} updated, ${result.unchanged} unchanged${
        result.refused.length ? `, ${result.refused.length} refused` : ""
      } — ${tail}`,
      payload: {
        sourceId: source.id,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        autoPublished: result.autoPublished,
        quarantined: result.quarantined,
        driftRevoked: result.driftRevoked,
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
