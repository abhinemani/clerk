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
import type { ServiceDeps } from "./deps";
import { NotFoundError } from "./repository";

export interface LegacyImportResult {
  imported: { publicId: string; legacyId: string | null }[];
  failed: { rowNumber: number; reason: string }[];
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
  // Dedupe requesters within this batch too — a legacy export commonly
  // repeats the same person across many rows.
  const requesterCache = new Map<string, string>(); // email -> requesterId

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

      await repo.appendEvent({
        id: deps.genId(),
        agencyId: input.agencyId,
        requestId: request.id,
        kind: "note",
        actorUserId: input.actorUserId,
        summary: `Imported from legacy system by ${actor.name ?? actor.email}${row.legacyId ? ` (legacy ref ${row.legacyId})` : ""}`,
        payload: {
          source: "legacy_import",
          legacyId: row.legacyId,
          legacyStatus: row.statusMatched ? null : "unrecognized — mapped to closed",
          department: row.department,
          warnings: row.warnings,
        },
        createdAt: deps.now(),
      });

      imported.push({ publicId, legacyId: row.legacyId });
    } catch (e) {
      failed.push({ rowNumber: row.rowNumber, reason: e instanceof Error ? e.message : "Import failed." });
    }
  }

  return { imported, failed };
}
