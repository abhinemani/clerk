/**
 * Mailbox import for fulfillment (roadmap: "most responsive records ARE
 * emails"). A coordinator uploads what IT hands them — an mbox export, a
 * single .eml, or a ZIP of .eml files — against ONE request; every message
 * becomes a review-set document (raw RFC 822 bytes preserved as the record,
 * searchable text rendition extracted) and every attachment becomes its own
 * linked document, so the whole export flows into staff search, the
 * exemption pass, and both redaction studios like any other upload.
 *
 * Fail-closed per item: an infected or oversize message/attachment is
 * refused and REPORTED, never stored — but one bad item doesn't sink a
 * 2,000-message export. Every refusal is in the audit event.
 */
import { blobKey, checksumOf, type BlobStore } from "@/adapters/blobStore";
import { looksLikeMailbox, messageTextRendition, parseMailbox, type ParsedEmailMessage } from "@/adapters/mailbox";
import { extractText, openZipArchive } from "@/adapters/textExtract";
import { assertUploadable, type VirusScanner } from "@/adapters/virusScan";
import { scanPii, summarizePii } from "@/ai/redaction/piiScan";
import type { DocumentMeta } from "@/domain/documentMeta";
import type { ServiceDeps } from "./deps";
import { NotFoundError } from "./repository";

export class MailboxImportError extends Error {}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // matches the upload paths
const MAX_ZIP_EMLS = 2000;

export interface MailboxImportResult {
  messages: number;
  attachments: number;
  /** Items refused (virus, oversize) — reason strings for the UI + audit. */
  refused: string[];
  /** 1-based indexes the parser could not read. */
  unparseable: number[];
  /** Any imported attachment with no text layer (OCR candidates). */
  textlessAttachments: number;
  /** Messages skipped because this request already holds them (Message-ID,
   *  or byte checksum when the id is absent) — overlapping exports are the
   *  normal case, not an error. */
  duplicates: number;
}

/**
 * Parse the upload into messages, tolerating all three shapes IT produces.
 * Exported for the preview action — preview and import parse identically.
 */
export function parseMailboxUpload(
  bytes: Buffer,
  filename: string | null,
): { messages: ParsedEmailMessage[]; unparseable: number[] } | null {
  const zip = filename?.toLowerCase().endsWith(".zip") || bytes.subarray(0, 4).toString("latin1") === "PK\x03\x04"
    ? openZipArchive(bytes)
    : null;
  if (zip) {
    const emlNames = zip.names.filter((n) => n.toLowerCase().endsWith(".eml")).slice(0, MAX_ZIP_EMLS);
    if (emlNames.length === 0) return null;
    const messages: ParsedEmailMessage[] = [];
    const unparseable: number[] = [];
    emlNames.forEach((name, i) => {
      const member = zip.read(name);
      const parsed = member ? parseMailbox(member).messages[0] : undefined;
      if (parsed) messages.push({ ...parsed, index: i + 1 });
      else unparseable.push(i + 1);
    });
    return { messages, unparseable };
  }
  if (!looksLikeMailbox(bytes, filename)) return null;
  const parsed = parseMailbox(bytes);
  return { messages: parsed.messages, unparseable: parsed.failedIndexes };
}

export async function importMailbox(
  deps: ServiceDeps & { blobStore: BlobStore; virusScanner: VirusScanner },
  input: {
    agencyId: string;
    requestId: string;
    actorUserId: string;
    filename: string;
    bytes: Buffer;
  },
): Promise<MailboxImportResult> {
  const { repo, blobStore, virusScanner } = deps;
  const actor = await repo.getUser(input.agencyId, input.actorUserId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);
  const request = await repo.getRequest(input.agencyId, input.requestId);
  if (!request) throw new NotFoundError("Request", input.requestId);

  const parsed = parseMailboxUpload(input.bytes, input.filename);
  if (!parsed || parsed.messages.length === 0) {
    throw new MailboxImportError(
      "That file doesn't look like a mailbox export — expected .mbox, .eml, or a ZIP of .eml files.",
    );
  }

  const refused: string[] = [];
  let importedMessages = 0;
  let attachmentCount = 0;
  let textlessAttachments = 0;
  let duplicates = 0;
  const now = deps.now();

  // Message-ID dedupe: IT re-exports overlap (same custodian, widened date
  // range) and a coordinator may import both. A message this request already
  // holds is skipped — with its attachments, which arrived with the original.
  // Message-ID when present, raw-byte checksum otherwise; both scoped to THIS
  // request (the same email on two different requests is two records, each
  // reviewed in its own request's context).
  const existingDocs = await repo.listRequestDocuments(input.agencyId, input.requestId);
  const seenMessageIds = new Set<string>();
  const seenChecksums = new Set<string>();
  for (const doc of existingDocs) {
    if (doc.provenance !== "email_ingest") continue;
    const id = (doc.metadata as Record<string, unknown> | null)?.emailMessageId;
    if (typeof id === "string" && id) seenMessageIds.add(id);
    if (doc.checksum) seenChecksums.add(doc.checksum);
  }

  for (const message of parsed.messages) {
    const label = message.subject ?? `message ${message.index}`;
    const checksum = checksumOf(message.raw);
    if (message.messageId ? seenMessageIds.has(message.messageId) : seenChecksums.has(checksum)) {
      duplicates++;
      continue;
    }
    if (message.messageId) seenMessageIds.add(message.messageId);
    seenChecksums.add(checksum);
    // Nothing enters the blob store unscanned — same rule as every upload.
    const scan = await assertUploadable(virusScanner, message.raw, `${label}.eml`);
    if (!scan.ok) {
      refused.push(scan.reason);
      continue;
    }
    importedMessages++;

    const rendition = messageTextRendition(message);
    const findings = scanPii(rendition);
    const emlName = `${String(message.index).padStart(4, "0")}-${sanitize(message.subject ?? "no-subject")}.eml`;
    const key = await blobStore.put(blobKey(input.agencyId, emlName), message.raw, "message/rfc822");

    const messageDoc = await repo.createDocument({
      id: deps.genId(),
      agencyId: input.agencyId,
      sourceId: null,
      externalSystemId: null,
      provenance: "email_ingest",
      filename: emlName,
      classification: "internal",
      recordType: "email",
      processingStatus: "ready",
      metadata: {
        title: message.subject ?? "(no subject)",
        emailFrom: message.from,
        emailTo: message.to,
        ...(message.cc ? { emailCc: message.cc } : {}),
        ...(message.messageId ? { emailMessageId: message.messageId } : {}),
        ...(message.inReplyTo ? { emailInReplyTo: message.inReplyTo } : {}),
        ...(message.references.length ? { emailReferences: message.references } : {}),
        ...(message.date ? { recordDate: message.date.toISOString().slice(0, 10) } : {}),
        attachmentCount: message.attachments.length,
        mailboxImportOf: input.filename,
        ...(findings.length > 0 ? { sensitivity: summarizePii(findings) } : {}),
      } satisfies DocumentMeta as Record<string, unknown>,
      blobRef: key,
      byteSize: message.raw.length,
      mimeType: "message/rfc822",
      checksum,
      extractedText: rendition,
      pageCount: 1,
      createdAt: now,
    });
    await repo.linkRequestDocument(input.agencyId, input.requestId, messageDoc.id);

    for (const attachment of message.attachments) {
      if (attachment.bytes.length > MAX_ATTACHMENT_BYTES) {
        refused.push(`"${attachment.filename}" (${label}) is over the 25 MB limit — not imported.`);
        continue;
      }
      const attScan = await assertUploadable(virusScanner, attachment.bytes, attachment.filename);
      if (!attScan.ok) {
        refused.push(attScan.reason);
        continue;
      }
      const extracted = extractText(attachment.bytes, attachment.mimeType);
      if (!extracted) textlessAttachments++;
      const attKey = await blobStore.put(
        blobKey(input.agencyId, `${String(message.index).padStart(4, "0")}-${attachment.filename}`),
        attachment.bytes,
        attachment.mimeType,
      );
      const attDoc = await repo.createDocument({
        id: deps.genId(),
        agencyId: input.agencyId,
        sourceId: null,
        externalSystemId: null,
        provenance: "email_ingest",
        filename: attachment.filename,
        classification: "internal",
        recordType: null,
        processingStatus: "ready",
        metadata: {
          attachmentOfDocumentId: messageDoc.id,
          emailSubject: message.subject,
          ...(message.date ? { recordDate: message.date.toISOString().slice(0, 10) } : {}),
          mailboxImportOf: input.filename,
        },
        blobRef: attKey,
        byteSize: attachment.bytes.length,
        mimeType: attachment.mimeType,
        checksum: checksumOf(attachment.bytes),
        extractedText: extracted ? extracted.lines.join("\n") : undefined,
        pageCount: extracted?.pageCount,
        createdAt: now,
      });
      await repo.linkRequestDocument(input.agencyId, input.requestId, attDoc.id);
      attachmentCount++;
    }
  }

  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: input.requestId,
    kind: "note",
    actorUserId: input.actorUserId,
    summary:
      `Mailbox export imported by ${actor.name ?? actor.email} — ${importedMessages} message(s), ${attachmentCount} attachment(s) from ${input.filename}` +
      (duplicates > 0 ? ` (${duplicates} already on this request, skipped)` : ""),
    payload: {
      source: "mailbox_import",
      filename: input.filename,
      messages: importedMessages,
      attachments: attachmentCount,
      duplicates,
      refused,
      unparseable: parsed.unparseable,
    },
    createdAt: now,
  });

  return {
    messages: importedMessages,
    attachments: attachmentCount,
    refused,
    unparseable: parsed.unparseable,
    textlessAttachments,
    duplicates,
  };
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9 _.-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "message";
}
