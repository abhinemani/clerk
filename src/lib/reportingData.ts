/**
 * Live §11 compliance dataset — shared by the on-screen report, its CSV
 * export, and the annual-report PDF, so all three are computed from the
 * exact same rows.
 */
import { getRepository } from "@/db/createRepository";
import type { RequestForMetrics } from "@/reporting/metrics";

export async function liveComplianceDataset(
  agencyId: string,
): Promise<{ records: RequestForMetrics[]; deflections: number }> {
  const repo = await getRepository();
  const [requests, requesters, deflections] = await Promise.all([
    repo.listRequests(agencyId),
    repo.listRequesters(agencyId),
    repo.listDeflections(agencyId),
  ]);
  const typeById = new Map(requesters.map((r) => [r.id, r.type]));
  return {
    records: requests.map((r) => ({
      receivedAt: r.receivedAt ?? r.createdAt,
      closedAt: r.closedAt, // real closure timestamps from the release flow
      statutoryDueAt: r.statutoryDueAt,
      status: r.status,
      requesterType: (r.requesterId && typeById.get(r.requesterId)) || "individual",
      extended: false,
      exemptionsCited: [],
    })),
    deflections: deflections.length,
  };
}
