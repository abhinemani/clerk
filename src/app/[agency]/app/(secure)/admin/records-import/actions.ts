"use server";

/**
 * Records CSV/ZIP import actions (docs/records-ingestion.md §1) + source
 * management (§4). Preview and import parse the SAME pure function
 * server-side; the import additionally streams matched ZIP members through
 * virus scan → blob store → text extraction. Admin-only, like the legacy
 * request importer next door.
 */
import { revalidatePath } from "next/cache";
import { openZipArchive } from "@/adapters/textExtract";
import { staffAction } from "@/auth/actionWrapper";
import { parseRecordsCsv, type RecordsImportRowError } from "@/domain/recordsImport";
import { importRecords, type ImportFile } from "@/services/recordsImportService";
import {
  PublicationError,
  rotateSourceApiKey,
  updateSourcePolicy,
} from "@/services/publicationService";

const MAX_ROWS = 2000;
const MAX_ZIP_BYTES = 25 * 1024 * 1024; // matches the server-action body limit

export interface RecordsPreview {
  ok: true;
  validCount: number;
  totalRows: number;
  missingHeaders: string[];
  errors: RecordsImportRowError[];
  warningCount: number;
  sample: { rowNumber: number; title: string; recordType: string | null; date: string | null; filename: string | null }[];
  /** ZIP reconciliation, when a ZIP came along. */
  zip: { memberCount: number; matchedRows: number; unmatchedCsvFiles: string[] } | null;
}

type ActionError = { ok: false; error: string };

async function zipMembers(formData: FormData): Promise<{ names: Set<string>; read: (name: string) => Buffer | null } | null | ActionError> {
  const zip = formData.get("zip");
  if (!(zip instanceof File) || zip.size === 0) return null;
  if (zip.size > MAX_ZIP_BYTES) return { ok: false, error: "Keep the ZIP under 25 MB (split larger archives)." };
  const archive = openZipArchive(Buffer.from(await zip.arrayBuffer()));
  if (!archive) return { ok: false, error: "That file doesn't look like a readable ZIP archive." };
  return { names: new Set(archive.names), read: archive.read };
}

/** Exact-name or basename match, mirroring the import service's tolerance. */
function matchesZip(names: Set<string>, filename: string): boolean {
  if (names.has(filename)) return true;
  for (const n of names) if (n.split("/").pop() === filename) return true;
  return false;
}

export const previewRecordsImportAction = staffAction(
  { roles: ["admin"], fallback: "Could not read the file." },
  async (_ctx, formData: FormData): Promise<RecordsPreview | ActionError> => {
  const csvText = String(formData.get("csv") ?? "");
  if (!csvText.trim()) return { ok: false, error: "Paste or upload the records CSV first." };

  const { rows, errors, missingHeaders } = parseRecordsCsv(csvText);
  if (rows.length + errors.length > MAX_ROWS) {
    return { ok: false, error: `Too many rows (max ${MAX_ROWS} per import — split the file).` };
  }

  const zip = await zipMembers(formData);
  if (zip && "ok" in zip) return zip;
  let zipSummary: RecordsPreview["zip"] = null;
  if (zip) {
    const withFile = rows.filter((r) => r.filename);
    zipSummary = {
      memberCount: zip.names.size,
      matchedRows: withFile.filter((r) => matchesZip(zip.names, r.filename!)).length,
      unmatchedCsvFiles: withFile.filter((r) => !matchesZip(zip.names, r.filename!)).map((r) => r.filename!).slice(0, 20),
    };
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
      title: r.title,
      recordType: r.recordType,
      date: r.date ? r.date.toISOString().slice(0, 10) : null,
      filename: r.filename,
    })),
    zip: zipSummary,
  };
  },
);

export const runRecordsImportAction = staffAction(
  { roles: ["admin"], fallback: "Import failed." },
  async (
    { staff, deps, agencySlug },
    formData: FormData,
  ): Promise<
    | { ok: true; imported: number; updated: number; withFiles: number; failed: { rowNumber: number; reason: string }[]; missingFiles: string[]; skippedInvalid: number }
    | ActionError
  > => {
  const csvText = String(formData.get("csv") ?? "");
  const { rows, errors } = parseRecordsCsv(csvText);
  if (rows.length === 0) return { ok: false, error: "Nothing to import — every row failed validation." };
  if (rows.length > MAX_ROWS) return { ok: false, error: `Too many rows (max ${MAX_ROWS} per import).` };

  const zip = await zipMembers(formData);
  if (zip && "ok" in zip) return zip;

  // Decompress ONLY the members the CSV references.
  let files: Map<string, ImportFile> | undefined;
  if (zip) {
    files = new Map();
    for (const row of rows) {
      if (!row.filename) continue;
      const memberName = zip.names.has(row.filename)
        ? row.filename
        : [...zip.names].find((n) => n.split("/").pop() === row.filename);
      if (!memberName || files.has(memberName)) continue;
      const bytes = zip.read(memberName);
      if (bytes) files.set(memberName, { bytes, mimeType: null });
    }
  }

    const { getBlobStore } = await import("@/adapters/blobStore");
    const { getVirusScanner } = await import("@/adapters/virusScan");
    const result = await importRecords(
      { ...deps, blobStore: getBlobStore(), virusScanner: getVirusScanner() },
      { agencyId: staff.agencyId, actorUserId: staff.userId, rows, files },
    );

    // Off the request path: AI classification hints for the publication queue
    // (no-op without a key) and staff-search vectors for the new corpus docs.
    const { getJobQueue } = await import("@/jobs/queue");
    if (result.imported.length > 0) {
      // Chunked: a 2000-row import becomes ~100 independent jobs, so one
      // mid-batch crash retries ~20 docs, not the whole import (each doc is
      // also individually idempotent via the aiClassification check).
      const CLASSIFY_CHUNK = 20;
      const ids = result.imported.map((r) => r.documentId);
      for (let i = 0; i < ids.length; i += CLASSIFY_CHUNK) {
        getJobQueue().enqueue("classify_documents", {
          agencyId: staff.agencyId,
          documentIds: ids.slice(i, i + CLASSIFY_CHUNK),
        });
      }
      getJobQueue().enqueue("embed_document_chunks", { agencyId: staff.agencyId });
    }

    revalidatePath(`/${agencySlug}/app/records`);
    return {
      ok: true,
      imported: result.imported.length,
      updated: result.imported.filter((r) => r.updated).length,
      withFiles: result.imported.filter((r) => r.hasFile).length,
      failed: result.failed,
      missingFiles: result.missingFiles,
      skippedInvalid: errors.length,
    };
  },
);

// --- source management (§4) --------------------------------------------------

export const updateSourcePolicyAction = staffAction(
  { roles: ["admin"], fallback: "Could not update the source.", exposes: [PublicationError] },
  async (
    { staff, deps, agencySlug },
    input: { sourceId: string; trust: "auto_publish" | "review_queue"; defaultClassification: "public" | "internal" },
  ): Promise<{ ok: true }> => {
    await updateSourcePolicy(deps, {
      agencyId: staff.agencyId,
      actorUserId: staff.userId,
      sourceId: input.sourceId,
      trust: input.trust,
      defaultClassification: input.defaultClassification,
    });
    revalidatePath(`/${agencySlug}/app/admin/records-import`);
    return { ok: true };
  },
);

export const rotateSourceKeyAction = staffAction(
  { roles: ["admin"], fallback: "Could not rotate the key.", exposes: [PublicationError] },
  async ({ staff, deps, agencySlug }, sourceId: string): Promise<{ ok: true; ingestKey: string }> => {
    const { ingestKey } = await rotateSourceApiKey(deps, {
      agencyId: staff.agencyId,
      actorUserId: staff.userId,
      sourceId,
    });
    revalidatePath(`/${agencySlug}/app/admin/records-import`);
    return { ok: true, ingestKey };
  },
);
