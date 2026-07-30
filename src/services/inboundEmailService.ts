/**
 * Inbound email ingest (spec §6.5 "email-in" — "the responder path of least
 * resistance and probably the highest-usage feature in the product").
 *
 * Two routes, both credential-addressed (possession of the address IS the
 * authorization — the same trust model as no-login task links):
 *
 *   task-{token}@{domain}  → a responder replying to a dispatch: attachments
 *     become review-set documents (blob-stored, checksummed, text-extracted),
 *     the task moves to `submitted` — identical to the upload page.
 *   req-{uuid}@{domain}    → a requester replying to correspondence: the body
 *     lands on the request's message thread (sender must match the requester's
 *     email — a reply address alone doesn't let a stranger speak for them);
 *     attachments attach to the request as email_ingest documents.
 *
 * Anything else is refused and (when it names a real request) logged — an
 * unmatched email is a signal, not silent data loss.
 */
import { blobKey, checksumOf } from "@/adapters/blobStore";
import { extractText } from "@/adapters/textExtract";
import type { ServiceDeps } from "./deps";
import { postRequesterReply, MessageError } from "./messageService";
import { parseInboundAddress } from "./notifications";
import { startTask, submitTaskRecords, type TaskUploadInput } from "./taskService";

export interface InboundAttachment {
  name: string;
  /** Base64 content, as inbound-webhook providers deliver it. */
  contentBase64: string;
  contentType?: string;
}

export interface InboundEmailInput {
  to: string;
  from: string;
  subject?: string;
  textBody: string;
  attachments?: InboundAttachment[];
}

export type InboundEmailResult =
  | {
      ok: true;
      route: "task_submission";
      taskId: string;
      agencyId: string;
      requestId: string;
      documents: number;
    }
  | { ok: true; route: "requester_reply"; requestId: string; attachments: number }
  | { ok: false; reason: string };

const MAX_ATTACHMENTS = 20;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export async function ingestInboundEmail(
  deps: ServiceDeps,
  input: InboundEmailInput,
): Promise<InboundEmailResult> {
  const route = parseInboundAddress(input.to);
  if (!route) return { ok: false, reason: "Unrecognized ingest address." };

  const attachments = (input.attachments ?? []).slice(0, MAX_ATTACHMENTS);

  if (route.kind === "task") {
    const task = await deps.repo.getTaskByToken(route.token);
    if (!task) return { ok: false, reason: "Unknown task address." };
    if (task.status !== "assigned" && task.status !== "in_progress") {
      // The task already left the responder's hands — don't mutate it from
      // email, but leave a trace on the request for the coordinator.
      await deps.repo.appendEvent({
        id: deps.genId(),
        agencyId: task.agencyId,
        requestId: task.requestId,
        kind: "note",
        actorUserId: null,
        summary: `Inbound email for a ${task.status.replace(/_/g, " ")} task was not ingested`,
        payload: { taskId: task.id, from: input.from, subject: input.subject ?? null },
        createdAt: deps.now(),
      });
      return { ok: false, reason: `Task is ${task.status} — nothing ingested.` };
    }
    if (attachments.length === 0) {
      return { ok: false, reason: "No attachments — task email-in expects records attached." };
    }
    if (!deps.blobStore) return { ok: false, reason: "No blob store configured." };

    const uploads: TaskUploadInput[] = [];
    for (const a of attachments) {
      const bytes = Buffer.from(a.contentBase64, "base64");
      if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES) continue;
      const key = await deps.blobStore.put(
        blobKey(task.agencyId, a.name),
        bytes,
        a.contentType ?? "application/octet-stream",
      );
      const extracted = extractText(bytes, a.contentType ?? null);
      uploads.push({
        name: a.name.slice(0, 200),
        blobRef: key,
        byteSize: bytes.length,
        mimeType: a.contentType ?? "application/octet-stream",
        checksum: checksumOf(bytes),
        extractedText: extracted ? extracted.lines.join("\n") : undefined,
        pageCount: extracted?.pageCount,
      });
    }
    if (uploads.length === 0) return { ok: false, reason: "No usable attachments." };

    if (task.status === "assigned") await startTask(deps, task.agencyId, task.id);
    await submitTaskRecords(deps, { agencyId: task.agencyId, taskId: task.id, uploads });
    await deps.repo.appendEvent({
      id: deps.genId(),
      agencyId: task.agencyId,
      requestId: task.requestId,
      kind: "note",
      actorUserId: null,
      summary: `Records received by email from ${input.from}`,
      payload: { taskId: task.id, documents: uploads.length, subject: input.subject ?? null },
      createdAt: deps.now(),
    });
    return {
      ok: true,
      route: "task_submission",
      taskId: task.id,
      agencyId: task.agencyId,
      requestId: task.requestId,
      documents: uploads.length,
    };
  }

  // --- requester reply ------------------------------------------------------
  const request = await deps.repo.getRequestByIngestId(route.requestId);
  if (!request) return { ok: false, reason: "Unknown request address." };
  const requester = request.requesterId
    ? await deps.repo.getRequester(request.agencyId, request.requesterId)
    : null;
  const senderMatches =
    requester?.email != null &&
    normalizeEmail(input.from) === normalizeEmail(requester.email);
  if (!senderMatches) {
    await deps.repo.appendEvent({
      id: deps.genId(),
      agencyId: request.agencyId,
      requestId: request.id,
      kind: "note",
      actorUserId: null,
      summary: "Inbound email from an unrecognized sender was not ingested",
      payload: { from: input.from, subject: input.subject ?? null },
      createdAt: deps.now(),
    });
    return { ok: false, reason: "Sender does not match the requester on file." };
  }

  const body = stripQuotedReply(input.textBody);
  try {
    await postRequesterReply(deps, {
      agencyId: request.agencyId,
      requestId: request.id,
      requesterId: request.requesterId!,
      body: body || "(empty message)",
    });
  } catch (e) {
    if (e instanceof MessageError) return { ok: false, reason: e.message };
    throw e;
  }

  let attached = 0;
  if (deps.blobStore) {
    for (const a of attachments) {
      const bytes = Buffer.from(a.contentBase64, "base64");
      if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES) continue;
      const key = await deps.blobStore.put(
        blobKey(request.agencyId, a.name),
        bytes,
        a.contentType ?? "application/octet-stream",
      );
      const extracted = extractText(bytes, a.contentType ?? null);
      const doc = await deps.repo.createDocument({
        id: deps.genId(),
        agencyId: request.agencyId,
        sourceId: null,
        externalSystemId: null,
        provenance: "email_ingest",
        filename: a.name.slice(0, 200),
        classification: "internal", // never public without a human (invariant 9)
        recordType: null,
        processingStatus: "ready",
        metadata: { requestId: request.id, from: input.from },
        blobRef: key,
        byteSize: bytes.length,
        mimeType: a.contentType ?? "application/octet-stream",
        checksum: checksumOf(bytes),
        extractedText: extracted ? extracted.lines.join("\n") : null,
        pageCount: extracted?.pageCount ?? null,
        createdAt: deps.now(),
      });
      await deps.repo.linkRequestDocument(request.agencyId, request.id, doc.id);
      attached++;
    }
  }

  return { ok: true, route: "requester_reply", requestId: request.id, attachments: attached };
}

function normalizeEmail(e: string): string {
  // "Jordan Alvarez <jordan@x.com>" → "jordan@x.com"
  const angled = e.match(/<([^>]+)>/);
  return (angled?.[1] ?? e).trim().toLowerCase();
}

/** Drop the quoted tail of a reply ("On … wrote:" and "> " lines). */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .{4,80} wrote:\s*$/.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}
