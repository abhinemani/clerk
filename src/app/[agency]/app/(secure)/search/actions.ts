"use server";

/**
 * Records-search actions (§6.4). Attach goes through the service layer:
 * link + named-actor audit event, then the exemption pass catches up on the
 * newly attached document.
 */
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { defaultDeps } from "@/services/deps";
import { attachDocumentToRequest } from "@/services/recordsSearchService";

export async function attachToRequestAction(input: {
  agencySlug: string;
  requestId: string;
  documentId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const staff = await requireStaff(input.agencySlug);
    const repo = await getRepository();
    await attachDocumentToRequest(defaultDeps(repo), {
      agencyId: staff.agencyId,
      requestId: input.requestId,
      documentId: input.documentId,
      actorUserId: staff.userId,
    });
    // Suggestions for the new document (no-op without ANTHROPIC_API_KEY).
    const { getJobQueue } = await import("@/jobs/queue");
    getJobQueue().enqueue("exemption_pass", {
      agencyId: staff.agencyId,
      requestId: input.requestId,
    });
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    revalidatePath(`/${input.agencySlug}/app/search`);
    return { ok: true };
  } catch (e) {
    console.error("attachToRequest failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Could not attach the document." };
  }
}
