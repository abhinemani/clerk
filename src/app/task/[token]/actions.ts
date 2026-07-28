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
