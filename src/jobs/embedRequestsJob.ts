/**
 * Ask-vector backfill (answer-first phase 4): give every request that lacks
 * an embedding one, so the precedent corpus includes history that predates
 * the write-at-submit hook — legacy-imported requests above all, which are
 * exactly the institutional memory RAG'd triage exists to use. Idempotent:
 * requests with a stored vector are skipped, so the boot-time enqueue is a
 * no-op once caught up. Works keyless via the deterministic fake provider.
 */
import { getRepository } from "@/db/createRepository";
import { defaultDeps } from "@/services/deps";
import { writeRequestEmbedding } from "@/services/similarRequestsService";
import type { JobPayloads } from "./queue";

export async function runEmbedRequestsJob(payload: JobPayloads["embed_requests"]): Promise<void> {
  const repo = await getRepository();
  const deps = defaultDeps(repo);
  const [requests, embedded] = await Promise.all([
    repo.listRequests(payload.agencyId),
    repo.listRequestEmbeddings(payload.agencyId),
  ]);
  const done = new Set(embedded.map((e) => e.id));
  for (const request of requests) {
    if (done.has(request.id)) continue;
    await writeRequestEmbedding(deps, { agencyId: payload.agencyId, requestId: request.id });
  }
}
