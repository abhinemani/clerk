"use server";

/**
 * Command-center (queue) actions — bulk assignment (§6.3 ergonomics at
 * volume). Wraps the same per-request assignCoordinator use case the
 * detail-page select calls; every row still gets its own named-actor audit
 * event. A failure on one request never blocks the rest of the batch.
 */
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { defaultDeps } from "@/services/deps";
import { assignCoordinator } from "@/services/requestService";

export type BulkAssignResult = { ok: true; assigned: number; failed: number } | { ok: false; error: string };

const MAX_BULK = 200;

export async function bulkAssignCoordinatorAction(input: {
  agencySlug: string;
  requestIds: string[];
  coordinatorUserId: string | null;
}): Promise<BulkAssignResult> {
  try {
    const staff = await requireStaff(input.agencySlug);
    if (input.requestIds.length === 0) return { ok: false, error: "Select at least one request." };
    if (input.requestIds.length > MAX_BULK) return { ok: false, error: `Select at most ${MAX_BULK} at once.` };

    const repo = await getRepository();
    const deps = defaultDeps(repo);
    let assigned = 0;
    let failed = 0;
    for (const requestId of input.requestIds) {
      try {
        await assignCoordinator(deps, {
          agencyId: staff.agencyId,
          requestId,
          coordinatorUserId: input.coordinatorUserId,
          actorUserId: staff.userId,
        });
        assigned++;
      } catch (e) {
        console.error(`bulkAssignCoordinator failed for ${requestId}`, e);
        failed++;
      }
    }
    revalidatePath(`/${input.agencySlug}/app`);
    return { ok: true, assigned, failed };
  } catch (e) {
    console.error("bulkAssignCoordinator failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Bulk assign failed." };
  }
}
