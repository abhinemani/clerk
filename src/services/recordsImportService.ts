/**
 * Records CSV/ZIP import (docs/records-ingestion.md §1) — the bulk pipe from
 * an office's existing systems into the corpus. Every imported document lands
 * `classification: "internal"`: a bulk import NEVER publishes anything; the
 * publication queue (publicationService) is where a named human decides.
 *
 * Bytes follow the same rule as every other upload path: nothing enters the
 * blob store unscanned (fail-closed), and text extraction happens at ingest so
 * the queue can show a preview and staff search can find the content.
 */
import { blobKey, checksumOf, type BlobStore } from "@/adapters/blobStore";
import { extractText } from "@/adapters/textExtract";
import { assertUploadable, type VirusScanner } from "@/adapters/virusScan";
import { scanPii, summarizePii } from "@/ai/redaction/piiScan";
import type { DocumentMeta } from "@/domain/documentMeta";
import type { ParsedRecordRow } from "@/domain/recordsImport";
import type { ServiceDeps } from "./deps";
import { NotFoundError, type DocumentEntity, type SourceEntity } from "./repository";

const FILE_DROP_SOURCE_NAME = "File drop";

/**
 * The agency's file-drop source, created lazily on first import (the way
 * provisioning creates the API source). Review-queue trust, internal default —
 * the safe posture for anything arriving in bulk.
 */
export async function ensureFileDropSource(deps: ServiceDeps, agencyId: string): Promise<SourceEntity> {
  const existing = (await deps.repo.listSources(agencyId)).find((s) => s.type === "file_drop");
  if (existing) return existing;
  return deps.repo.createSource({
    id: deps.genId(),
    agencyId,
    name: FILE_DROP_SOURCE_NAME,
    type: "file_drop",
    apiKeyHash: null,
    trust: "review_queue",
    defaultClassification: "internal",
  });
}

export interface ImportFile {
  bytes: Buffer;
  mimeType: string | null;
}

export interface RecordsImportResult {
  /** Created or (by external_id) updated documents. */
  imported: { rowNumber: number; documentId: string; title: string; updated: boolean; hasFile: boolean }[];
  failed: { rowNumber: number; reason: string }[];
  /** CSV filenames that matched nothing in the ZIP — imported metadata-only. */
  missingFiles: string[];
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

function guessMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Import parsed rows (+ optional file bytes keyed by filename). Row-granular:
 * a failed row (virus hit, storage error) never aborts the batch. One admin
 * event summarizes the whole batch under the importing admin's name.
 */
export async function importRecords(
  deps: ServiceDeps & { blobStore: BlobStore; virusScanner: VirusScanner },
  input: {
    agencyId: string;
    actorUserId: string;
    rows: ParsedRecordRow[];
    /** ZIP members (or individually uploaded files), keyed by member name. */
    files?: Map<string, ImportFile>;
  },
): Promise<RecordsImportResult> {
  const { repo } = deps;
  const agency = await repo.getAgency(input.agencyId);
  if (!agency) throw new NotFoundError("Agency", input.agencyId);
  const actor = await repo.getUser(input.agencyId, input.actorUserId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);

  const source = await ensureFileDropSource(deps, input.agencyId);

  // Match CSV filenames against ZIP members by exact name, then by basename
  // (offices zip folders; "minutes/jan.pdf" should satisfy "jan.pdf").
  const byBasename = new Map<string, string>();
  for (const name of input.files?.keys() ?? []) {
    const base = name.split("/").pop()!;
    if (!byBasename.has(base)) byBasename.set(base, name);
  }
  const resolveFile = (filename: string): ImportFile | null => {
    if (!input.files) return null;
    const direct = input.files.get(filename);
    if (direct) return direct;
    const viaBase = byBasename.get(filename);
    return viaBase ? (input.files.get(viaBase) ?? null) : null;
  };

  const imported: RecordsImportResult["imported"] = [];
  const failed: RecordsImportResult["failed"] = [];
  const missingFiles: string[] = [];

  for (const row of input.rows) {
    try {
      const file = row.filename ? resolveFile(row.filename) : null;
      if (row.filename && !file) missingFiles.push(row.filename);

      // Blob fields only when real bytes arrived — absent keys (not
      // undefined values) so an external-id re-import without the ZIP
      // doesn't clobber previously stored bytes.
      let blobFields: Partial<DocumentEntity> = {};
      if (file && row.filename) {
        const mimeType = file.mimeType ?? guessMime(row.filename);
        // Nothing enters the blob store unscanned (fail-closed) — ZIP
        // members included.
        const scan = await assertUploadable(deps.virusScanner, file.bytes, row.filename);
        if (!scan.ok) {
          failed.push({ rowNumber: row.rowNumber, reason: scan.reason });
          continue;
        }
        const key = await deps.blobStore.put(blobKey(input.agencyId, row.filename), file.bytes, mimeType);
        const extracted = extractText(file.bytes, mimeType);
        blobFields = {
          blobRef: key,
          byteSize: file.bytes.length,
          mimeType,
          checksum: checksumOf(file.bytes),
          ...(extracted
            ? { extractedText: extracted.lines.join("\n"), pageCount: extracted.pageCount }
            : {}),
        };
      }

      // Deterministic PII pre-scan (§6.5) — same scanner the API ingest path
      // runs in normalize(). No API key involved; the queue renders the
      // tallies as a warning before anyone clicks Publish.
      const scanText = blobFields.extractedText ?? row.summary ?? "";
      const findings = scanPii(scanText);
      const metadata: DocumentMeta = {
        title: row.title,
        ...(row.summary ? { summary: row.summary } : {}),
        tags: row.tags,
        keywords: row.keywords,
        ...(row.date ? { recordDate: row.date.toISOString().slice(0, 10) } : {}),
        ...(findings.length > 0 ? { sensitivity: summarizePii(findings) } : {}),
      };

      const doc: DocumentEntity = {
        id: deps.genId(),
        agencyId: input.agencyId,
        sourceId: source.id,
        externalSystemId: row.externalId,
        provenance: "connector",
        filename: row.filename,
        // NEVER public from a bulk import — the publication queue is the
        // only door (docs/records-ingestion.md invariants).
        classification: "internal",
        recordType: row.recordType,
        processingStatus: "ready",
        metadata,
        createdAt: deps.now(),
        ...blobFields,
      };

      if (row.externalId) {
        const { document, created } = await repo.upsertDocumentByExternalId(doc);
        imported.push({
          rowNumber: row.rowNumber,
          documentId: document.id,
          title: row.title,
          updated: !created,
          hasFile: file != null,
        });
      } else {
        const document = await repo.createDocument(doc);
        imported.push({
          rowNumber: row.rowNumber,
          documentId: document.id,
          title: row.title,
          updated: false,
          hasFile: file != null,
        });
      }
    } catch (e) {
      failed.push({ rowNumber: row.rowNumber, reason: e instanceof Error ? e.message : "Import failed." });
    }
  }

  const withFiles = imported.filter((r) => r.hasFile).length;
  await repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "records_imported",
    actorLabel: actor.name ?? actor.email,
    summary: `Imported ${imported.length} record(s) via file drop (${withFiles} with files, ${
      imported.filter((r) => r.updated).length
    } updated in place)${failed.length ? ` — ${failed.length} row(s) failed` : ""}`,
    payload: {
      sourceId: source.id,
      imported: imported.length,
      withFiles,
      failed: failed.map((f) => ({ rowNumber: f.rowNumber, reason: f.reason })),
      missingFiles: missingFiles.slice(0, 50),
    },
    createdAt: deps.now(),
  });

  return { imported, failed, missingFiles };
}
