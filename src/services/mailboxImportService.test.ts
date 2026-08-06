/**
 * Mailbox import — a custodian's email export becomes review-set documents:
 * raw .eml preserved as the record, text rendition searchable/redactable,
 * attachments as their own linked documents, refusals fail closed per item.
 */
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { BlobStore, StoredBlob } from "@/adapters/blobStore";
import { BuiltinScanner } from "@/adapters/virusScan";

// The EICAR test string (safe by definition; the builtin scanner detects it).
const EICAR_TEST_STRING =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
import { InMemoryRepository, type Agency } from "./repository";
import type { ServiceDeps } from "./deps";
import { importMailbox, MailboxImportError, parseMailboxUpload } from "./mailboxImportService";
import { submitRequest } from "./requestService";

const AGENCY: Agency = { id: "ag-1", slug: "riverton", name: "City of Riverton", stateCode: "CA", observedHolidays: [] };

class MemoryBlobStore implements BlobStore {
  readonly blobs = new Map<string, StoredBlob>();
  async put(key: string, bytes: Buffer, contentType: string) {
    this.blobs.set(key, { bytes, contentType });
    return key;
  }
  async get(key: string) {
    return this.blobs.get(key) ?? null;
  }
}

const CRLF = "\r\n";

function message(subject: string, body: string, attachment?: { name: string; content: string }): string {
  if (!attachment) {
    return [
      "From: Marcus Bell <mbell@riverton.gov>",
      "To: dana@riverton.gov",
      "Date: Tue, 14 Jan 2025 09:30:00 -0800",
      `Subject: ${subject}`,
      "Content-Type: text/plain",
      "",
      body,
    ].join(CRLF);
  }
  return [
    "From: Marcus Bell <mbell@riverton.gov>",
    "To: dana@riverton.gov",
    "Date: Tue, 14 Jan 2025 09:30:00 -0800",
    `Subject: ${subject}`,
    'Content-Type: multipart/mixed; boundary="BB"',
    "",
    "--BB",
    "Content-Type: text/plain",
    "",
    body,
    "--BB",
    `Content-Type: text/plain; name="${attachment.name}"`,
    `Content-Disposition: attachment; filename="${attachment.name}"`,
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(attachment.content).toString("base64"),
    "--BB--",
  ].join(CRLF);
}

function mboxOf(...messages: string[]): Buffer {
  return Buffer.from(messages.map((m) => `From x Tue Jan 14 09:30:00 2025\n${m}\n`).join("\n"), "latin1");
}

async function setup() {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  await repo.createUser({ id: "u-dana", agencyId: "ag-1", email: "dana@riverton.gov", name: "Dana", role: "coordinator", passwordHash: "x" });
  const blobStore = new MemoryBlobStore();
  let n = 0;
  const deps = {
    repo,
    now: () => new Date("2026-08-06T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
    blobStore,
    virusScanner: new BuiltinScanner(), // EICAR-only, no services
  } satisfies ServiceDeps & { blobStore: BlobStore; virusScanner: BuiltinScanner };
  const request = await submitRequest(deps, { agencyId: "ag-1", rawText: "All emails about Elm St paving." });
  return { repo, deps, blobStore, request };
}

describe("importMailbox", () => {
  it("explodes an mbox into message + attachment documents in the review set", async () => {
    const s = await setup();
    const result = await importMailbox(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      actorUserId: "u-dana",
      filename: "bell-export.mbox",
      bytes: mboxOf(
        message("Paving schedule", "Attached. Call 555-867-5309 with SSN 123-45-6789 issues.", { name: "schedule.txt", content: "Elm St paving: March 3-7." }),
        message("Re: Paving schedule", "Looks good."),
      ),
    });

    expect(result).toMatchObject({ messages: 2, attachments: 1, refused: [], unparseable: [] });

    const docs = await s.repo.listRequestDocuments("ag-1", s.request.id);
    expect(docs).toHaveLength(3); // 2 messages + 1 attachment
    const msgDoc = docs.find((d) => d.filename?.includes("Paving-schedule"))!;
    expect(msgDoc.provenance).toBe("email_ingest");
    expect(msgDoc.mimeType).toBe("message/rfc822");
    expect(msgDoc.recordType).toBe("email");
    expect(msgDoc.classification).toBe("internal");
    // The searchable rendition carries headers + body.
    expect(msgDoc.extractedText).toContain("From: Marcus Bell <mbell@riverton.gov>");
    expect(msgDoc.extractedText).toContain("Call 555-867-5309");
    // Deterministic PII pre-scan stamped for the queue/studio.
    expect((msgDoc.metadata as { sensitivity?: Record<string, number> }).sensitivity?.ssn).toBeGreaterThanOrEqual(1);
    // The RAW .eml is the stored record.
    const raw = await s.blobStore.get(msgDoc.blobRef!);
    expect(raw!.bytes.toString("latin1")).toContain("Subject: Paving schedule");

    const attDoc = docs.find((d) => d.filename === "schedule.txt")!;
    expect(attDoc.provenance).toBe("email_ingest");
    expect(attDoc.extractedText).toContain("Elm St paving: March 3-7.");
    expect((attDoc.metadata as { attachmentOfDocumentId?: string }).attachmentOfDocumentId).toBe(msgDoc.id);

    // Audited under the actor's name with full counts.
    const events = await s.repo.listEvents("ag-1", s.request.id);
    const note = events.find((e) => e.payload?.source === "mailbox_import")!;
    expect(note.actorUserId).toBe("u-dana");
    expect(note.summary).toContain("2 message(s), 1 attachment(s)");
  });

  it("imports a ZIP of .eml files", async () => {
    const s = await setup();
    // Build a minimal stored (uncompressed) zip with two .eml members.
    const zip = buildStoredZip([
      { name: "one.eml", data: message("Zip one", "body one") },
      { name: "two.eml", data: message("Zip two", "body two") },
      { name: "notes.txt", data: "not an email" },
    ]);
    const result = await importMailbox(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      actorUserId: "u-dana",
      filename: "export.zip",
      bytes: zip,
    });
    expect(result.messages).toBe(2);
    const docs = await s.repo.listRequestDocuments("ag-1", s.request.id);
    expect(docs.map((d) => (d.metadata as { title?: string }).title).sort()).toEqual(["Zip one", "Zip two"]);
  });

  it("refuses infected items per-item and reports them — the rest imports", async () => {
    const s = await setup();
    const result = await importMailbox(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      actorUserId: "u-dana",
      filename: "export.mbox",
      bytes: mboxOf(
        message("Clean", "fine"),
        message("Sketchy", "body", { name: "payload.txt", content: EICAR_TEST_STRING }),
      ),
    });
    expect(result.messages).toBe(2); // both messages import…
    expect(result.attachments).toBe(0); // …but the infected attachment does not
    expect(result.refused).toHaveLength(1);
    expect(result.refused[0]).toContain("payload.txt");
    const docs = await s.repo.listRequestDocuments("ag-1", s.request.id);
    expect(docs.some((d) => d.filename === "payload.txt")).toBe(false);
  });

  it("rejects non-mailbox uploads with an honest error", async () => {
    const s = await setup();
    await expect(
      importMailbox(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        actorUserId: "u-dana",
        filename: "report.pdf",
        bytes: Buffer.from("%PDF-1.4 not an email"),
      }),
    ).rejects.toThrow(MailboxImportError);
  });
});

describe("parseMailboxUpload", () => {
  it("returns null for non-mail bytes and parses each supported shape", () => {
    expect(parseMailboxUpload(Buffer.from("%PDF-"), "a.pdf")).toBeNull();
    expect(parseMailboxUpload(Buffer.from(message("Solo", "x")), "m.eml")?.messages).toHaveLength(1);
    expect(parseMailboxUpload(mboxOf(message("A", "x"), message("B", "y")), "e.mbox")?.messages).toHaveLength(2);
  });
});

/** Minimal zip with STORED (uncompressed) members — enough for openZipArchive. */
function buildStoredZip(entries: { name: string; data: string }[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.from(e.data, "latin1");
    const name = Buffer.from(e.name, "latin1");
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(raw.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, raw);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(raw.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += 30 + name.length + raw.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}
