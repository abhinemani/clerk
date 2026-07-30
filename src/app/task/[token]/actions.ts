"use server";

/**
 * Responder actions — authenticated by the task token itself (spec §3: the
 * no-login link IS the credential; it's unguessable and scoped to one task).
 * Every action re-resolves the task from the token server-side.
 */
import { revalidatePath } from "next/cache";
import { getRepository } from "@/db/createRepository";
import { defaultDeps } from "@/services/deps";
import { pushBackTask, startTask, submitTaskRecords } from "@/services/taskService";

export type ResponderResult = { ok: true } | { ok: false; error: string };

async function taskFromToken(token: string) {
  const repo = await getRepository();
  const task = await repo.getTaskByToken(token);
  if (!task) return null;
  return { repo, task, deps: defaultDeps(repo) };
}

export async function startTaskAction(token: string): Promise<ResponderResult> {
  const ctx = await taskFromToken(token);
  if (!ctx) return { ok: false, error: "This task link is no longer valid." };
  try {
    await startTask(ctx.deps, ctx.task.agencyId, ctx.task.id);
    revalidatePath(`/task/${token}`);
    return { ok: true };
  } catch (e) {
    console.error("startTask failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Could not start the task." };
  }
}

export async function submitRecordsAction(
  token: string,
  uploads: { name: string; pages?: number }[],
): Promise<ResponderResult> {
  const ctx = await taskFromToken(token);
  if (!ctx) return { ok: false, error: "This task link is no longer valid." };
  if (!uploads.length) return { ok: false, error: "Attach at least one record before submitting." };
  try {
    await submitTaskRecords(ctx.deps, {
      agencyId: ctx.task.agencyId,
      taskId: ctx.task.id,
      uploads: uploads.map((u) => ({ name: String(u.name).slice(0, 200), pages: u.pages })),
    });
    revalidatePath(`/task/${token}`);
    return { ok: true };
  } catch (e) {
    console.error("submitRecords failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Could not submit the records." };
  }
}

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file
const MAX_FILES = 20;

/**
 * Submit REAL files: bytes land in the blob store (checksummed), each becomes
 * a corpus document in the request's review set. Token-authenticated like
 * everything else on this page.
 */
export async function submitRecordFilesAction(
  token: string,
  formData: FormData,
): Promise<ResponderResult> {
  const ctx = await taskFromToken(token);
  if (!ctx) return { ok: false, error: "This task link is no longer valid." };

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, error: "Attach at least one record before submitting." };
  if (files.length > MAX_FILES) return { ok: false, error: `At most ${MAX_FILES} files per submission.` };
  const oversize = files.find((f) => f.size > MAX_FILE_BYTES);
  if (oversize) return { ok: false, error: `"${oversize.name}" is over the 25 MB limit.` };

  try {
    const { getBlobStore, blobKey, checksumOf } = await import("@/adapters/blobStore");
    const { extractText } = await import("@/adapters/textExtract");
    const store = getBlobStore();

    const uploads = [];
    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const key = await store.put(
        blobKey(ctx.task.agencyId, file.name),
        bytes,
        file.type || "application/octet-stream",
      );
      // Extraction at ingest (§6.5) — the redaction studio needs the text
      // rendition; a document with none can only be withheld or released whole.
      const extracted = extractText(bytes, file.type || null);
      uploads.push({
        name: file.name.slice(0, 200),
        blobRef: key,
        byteSize: bytes.length,
        mimeType: file.type || "application/octet-stream",
        checksum: checksumOf(bytes),
        extractedText: extracted ? extracted.lines.join("\n") : undefined,
        pageCount: extracted?.pageCount,
      });
    }

    await submitTaskRecords(ctx.deps, {
      agencyId: ctx.task.agencyId,
      taskId: ctx.task.id,
      uploads,
    });

    // AI proposes off the request path: exemption suggestions for the studio
    // (§6.5 step 2). No-ops without ANTHROPIC_API_KEY.
    const { getJobQueue } = await import("@/jobs/queue");
    getJobQueue().enqueue("exemption_pass", {
      agencyId: ctx.task.agencyId,
      requestId: ctx.task.requestId,
    });

    revalidatePath(`/task/${token}`);
    return { ok: true };
  } catch (e) {
    console.error("submitRecordFiles failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Could not upload the records." };
  }
}

export async function pushBackAction(token: string, note: string): Promise<ResponderResult> {
  const ctx = await taskFromToken(token);
  if (!ctx) return { ok: false, error: "This task link is no longer valid." };
  if (!note.trim()) return { ok: false, error: "Tell the coordinator what's blocking this." };
  try {
    await pushBackTask(ctx.deps, {
      agencyId: ctx.task.agencyId,
      taskId: ctx.task.id,
      note: note.trim().slice(0, 2000),
    });
    revalidatePath(`/task/${token}`);
    return { ok: true };
  } catch (e) {
    console.error("pushBack failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Could not send the pushback." };
  }
}
