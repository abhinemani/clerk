/**
 * Legacy request import (roadmap Tier 1: "no office starts empty") — turns a
 * validated CSV export from NextRequest/GovQA/a spreadsheet into real
 * requests, run through the repository so the history is real and queryable
 * (it seeds the queue, the archive/answer-box corpus, and duplicate
 * detection with years of signal, exactly like a live-filed request would).
 *
 * Deliberately does NOT call submitRequest: importing hundreds of historical
 * rows must not fire milestone emails, auto-assignment, or auto-dispatch —
 * those are live-workflow behaviors, and a bulk historical load is not a
 * live event. It also does NOT run the request through the transition state
 * machine (assertTransition) — a row may already be "fulfilled" the moment
 * it's created, which no live transition path allows, and the state machine
 * exists to police movement, not history. What's preserved: tenant scoping,
 * the append-only audit log (one "note" event per import, naming the actor
 * and carrying the row's original fields), and real timestamps.
 */
import { formatPublicId } from "@/domain/publicId";
import type { ParsedLegacyRow } from "@/domain/legacyImport";
import { addAskAlias, readDocumentMeta } from "@/domain/documentMeta";
import type { ServiceDeps } from "./deps";
import { NotFoundError, type DocumentEntity } from "./repository";

export interface LegacyImportResult {
  imported: { publicId: string; legacyId: string | null; linkedDocuments: number }[];
  failed: { rowNumber: number; reason: string }[];
  /** Release-history linkage totals (0 when the CSV had no released_records column). */
  releasesCreated: number;
  documentsLinked: number;
  /** external_ids named in the CSV that matched no imported document. */
  missingRecordIds: string[];
}

export async function importLegacyRequests(
  deps: ServiceDeps,
  input: { agencyId: string; actorUserId: string; rows: ParsedLegacyRow[] },
): Promise<LegacyImportResult> {
  const { repo } = deps;
  const agency = await repo.getAgency(input.agencyId);
  if (!agency) throw new NotFoundError("Agency", input.agencyId);
  const actor = await repo.getUser(input.agencyId, input.actorUserId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);

  const imported: LegacyImportResult["imported"] = [];
  const failed: LegacyImportResult["failed"] = [];
  let releasesCreated = 0;
  let documentsLinked = 0;
  const missingRecordIds = new Set<string>();
  // Dedupe requesters within this batch too — a legacy export commonly
  // repeats the same person across many rows.
  const requesterCache = new Map<string, string>(); // email -> requesterId

  // Release-history linkage (the onboarding lever): rows may name the
  // external_ids of already-imported documents they RELEASED. Load the
  // lookup once — only when some row actually uses it.
  let docsByExternalId: Map<string, DocumentEntity> | null = null;
  if (input.rows.some((r) => r.releasedRecordIds.length > 0)) {
    docsByExternalId = new Map(
      (await repo.listDocuments(input.agencyId))
        .filter((d) => d.externalSystemId != null)
        .map((d) => [d.externalSystemId!, d] as const),
    );
  }

  for (const row of input.rows) {
    try {
      let requesterId: string | null = null;
      if (row.requesterEmail) {
        requesterId = requesterCache.get(row.requesterEmail) ?? null;
        if (!requesterId) {
          const existing = await repo.findRequesterByEmail(input.agencyId, row.requesterEmail);
          requesterId = existing
            ? existing.id
            : (
                await repo.createRequester({
                  id: deps.genId(),
                  agencyId: input.agencyId,
                  email: row.requesterEmail,
                  name: row.requesterName,
                  type: "individual",
                })
              ).id;
          requesterCache.set(row.requesterEmail, requesterId);
        }
      } else if (row.requesterName) {
        requesterId = (
          await repo.createRequester({
            id: deps.genId(),
            agencyId: input.agencyId,
            email: null,
            name: row.requesterName,
            type: "individual",
          })
        ).id;
      }

      const year = row.receivedAt.getUTCFullYear();
      const seq = await repo.nextPublicIdSeq(input.agencyId, year);
      const publicId = formatPublicId(year, seq);

      const request = await repo.createRequest({
        id: deps.genId(),
        agencyId: input.agencyId,
        publicId,
        requesterId,
        status: row.status,
        rawText: row.description,
        interpretedScope: row.description,
        recordTypes: row.recordType ? [row.recordType] : [],
        complexityScore: null,
        receivedAt: row.receivedAt,
        statutoryDueAt: row.dueAt,
        closedAt: row.closedAt,
        createdAt: row.receivedAt,
      });

      // Link this request's historical release, when the row names records.
      // The publicness decision is NEVER made here (invariant 9): docs keep
      // whatever classification a human already gave them, and the minted
      // release is public only when every linked doc already IS public —
      // deriving from prior named-human decisions, not flipping anything.
      let releaseId: string | null = null;
      const releasedDocs: DocumentEntity[] = [];
      const missingHere: string[] = [];
      if (row.releasedRecordIds.length > 0 && docsByExternalId) {
        for (const externalId of row.releasedRecordIds) {
          const doc = docsByExternalId.get(externalId);
          if (doc) releasedDocs.push(doc);
          else {
            missingHere.push(externalId);
            missingRecordIds.add(externalId);
          }
        }
        if (releasedDocs.length > 0) {
          for (const doc of releasedDocs) {
            await repo.linkRequestDocument(input.agencyId, request.id, doc.id);
          }
          const release = await repo.createRelease({
            id: deps.genId(),
            agencyId: input.agencyId,
            requestId: request.id,
            artifacts: releasedDocs.map((d) => ({
              blobRef: d.blobRef ?? d.filename ?? d.id,
              filename: d.filename ?? d.id,
              checksum: d.checksum ?? `legacy:${d.id}`,
              documentId: d.id,
            })),
            responseLetter: null,
            visibility: releasedDocs.every((d) => d.classification === "public")
              ? "public"
              : "private",
            approvedByUserId: input.actorUserId,
            releasedAt: row.closedAt ?? row.receivedAt,
          });
          releaseId = release.id;
          releasesCreated++;
          documentsLinked += releasedDocs.length;

          // The ask-alias loop + archive backlink, best-effort like the live
          // release path: a learning write must never fail a history load.
          for (const doc of releasedDocs) {
            try {
              const meta = readDocumentMeta(doc);
              const nextAliases = addAskAlias(meta, row.description);
              const patch: Record<string, unknown> = { ...(doc.metadata ?? {}) };
              if (nextAliases) patch.askedAs = nextAliases;
              if (!meta.releaseId) patch.releaseId = release.id;
              await repo.updateDocument(input.agencyId, doc.id, {
                metadata: patch as DocumentEntity["metadata"],
              });
            } catch (e) {
              console.error("[legacyImport] alias/backlink write failed (non-fatal)", e);
            }
          }
        }
      }

      await repo.appendEvent({
        id: deps.genId(),
        agencyId: input.agencyId,
        requestId: request.id,
        kind: "note",
        actorUserId: input.actorUserId,
        summary: `Imported from legacy system by ${actor.name ?? actor.email}${row.legacyId ? ` (legacy ref ${row.legacyId})` : ""}${releasedDocs.length > 0 ? ` — ${releasedDocs.length} released document(s) linked` : ""}`,
        payload: {
          source: "legacy_import",
          legacyId: row.legacyId,
          legacyStatus: row.statusMatched ? null : "unrecognized — mapped to closed",
          department: row.department,
          warnings: row.warnings,
          ...(releaseId ? { releaseId, releasedDocumentIds: releasedDocs.map((d) => d.id) } : {}),
          ...(missingHere.length > 0 ? { missingReleasedRecordIds: missingHere } : {}),
        },
        createdAt: deps.now(),
      });

      imported.push({ publicId, legacyId: row.legacyId, linkedDocuments: releasedDocs.length });
    } catch (e) {
      failed.push({ rowNumber: row.rowNumber, reason: e instanceof Error ? e.message : "Import failed." });
    }
  }

  return {
    imported,
    failed,
    releasesCreated,
    documentsLinked,
    missingRecordIds: [...missingRecordIds],
  };
}
