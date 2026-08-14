"use server";

/**
 * Legacy import actions (roadmap Tier 1). Preview and import both parse the
 * SAME pure function server-side — the client never re-implements parsing,
 * and what you previewed is exactly what gets written.
 */
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { parseLegacyCsv, type LegacyImportRowError, type ParsedLegacyRow } from "@/domain/legacyImport";
import { defaultDeps } from "@/services/deps";
import { importLegacyRequests, type LegacyImportResult } from "@/services/legacyImportService";

const MAX_ROWS = 2000;

export interface PreviewResult {
  ok: true;
  validCount: number;
  totalRows: number;
  missingHeaders: string[];
  errors: LegacyImportRowError[];
  warningCount: number;
  /** First few parsed rows, for a "does this look right" sanity check. */
  sample: Pick<ParsedLegacyRow, "rowNumber" | "description" | "status" | "receivedAt" | "requesterName">[];
}

function summarize(csvText: string): { ok: true } & PreviewResult | { ok: false; error: string } {
  if (!csvText.trim()) return { ok: false, error: "Paste or upload a CSV first." };
  const { rows, errors, missingHeaders } = parseLegacyCsv(csvText);
  if (rows.length + errors.length > MAX_ROWS) {
    return { ok: false, error: `Too many rows (max ${MAX_ROWS} per import — split the file).` };
  }
  return {
    ok: true,
    validCount: rows.length,
    totalRows: rows.length + errors.length,
    missingHeaders,
    errors: errors.slice(0, 50),
    warningCount: rows.filter((r) => r.warnings.length > 0).length,
    sample: rows.slice(0, 8).map((r) => ({
      rowNumber: r.rowNumber,
      description: r.description,
      status: r.status,
      receivedAt: r.receivedAt,
      requesterName: r.requesterName,
    })),
  };
}

export async function previewLegacyImportAction(
  agencySlug: string,
  csvText: string,
): Promise<{ ok: false; error: string } | ({ ok: true } & PreviewResult)> {
  await requireStaff(agencySlug, ["admin"]);
  return summarize(csvText);
}

export async function runLegacyImportAction(
  agencySlug: string,
  csvText: string,
): Promise<{ ok: false; error: string } | ({ ok: true } & LegacyImportResult & { skippedInvalid: number })> {
  const staff = await requireStaff(agencySlug, ["admin"]);
  const { rows, errors } = parseLegacyCsv(csvText);
  if (rows.length === 0) return { ok: false, error: "Nothing to import — every row failed validation." };
  if (rows.length > MAX_ROWS) return { ok: false, error: `Too many rows (max ${MAX_ROWS} per import).` };

  const repo = await getRepository();
  const result = await importLegacyRequests(defaultDeps(repo), {
    agencyId: staff.agencyId,
    actorUserId: staff.userId,
    rows,
  });

  // The imported history joins the precedent corpus without waiting for the
  // next boot backfill (idempotent — already-embedded rows are skipped).
  try {
    const { getJobQueue } = await import("@/jobs/queue");
    getJobQueue().enqueue("embed_requests", { agencyId: staff.agencyId });
  } catch (e) {
    console.error("embed_requests enqueue after legacy import failed", e);
  }

  return { ok: true, ...result, skippedInvalid: errors.length };
}
