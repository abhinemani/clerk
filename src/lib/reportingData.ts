/**
 * Live §11 compliance dataset — shared by the on-screen report, its CSV
 * export, and the annual-report PDF, so all three are computed from the
 * exact same rows.
 */
import { getRepository } from "@/db/createRepository";
import type { Repository } from "@/services/repository";
import type { RequestForMetrics } from "@/reporting/metrics";

/**
 * Exemption citations for one request, deduplicated: an annual report counts
 * how many REQUESTS invoked an exemption, not how many documents sat under
 * it — a 40-page withholding under one citation is one use of the exemption.
 * Two sources, matching where citations actually live:
 *  - per-document review decisions (withhold / release_redacted carry a label);
 *  - formal denials, whose citations ride the status_change event payload
 *    (a denial can cite exemptions without any document ever being reviewed).
 */
function citationsFor(
  reviewLabels: string[] | undefined,
  denialCitations: string[] | undefined,
): string[] {
  return [...new Set([...(reviewLabels ?? []), ...(denialCitations ?? [])])];
}

export async function liveComplianceDataset(
  agencyId: string,
  repoOverride?: Repository,
): Promise<{ records: RequestForMetrics[]; deflections: number }> {
  const repo = repoOverride ?? (await getRepository());
  const [requests, requesters, deflections, reviews] = await Promise.all([
    repo.listRequests(agencyId),
    repo.listRequesters(agencyId),
    repo.listDeflections(agencyId),
    repo.listAgencyReviews(agencyId),
  ]);
  const typeById = new Map(requesters.map((r) => [r.id, r.type]));

  const reviewLabelsByRequest = new Map<string, string[]>();
  for (const review of reviews) {
    if (review.decision === "release" || !review.exemptionLabel) continue;
    const labels = reviewLabelsByRequest.get(review.requestId) ?? [];
    labels.push(review.exemptionLabel);
    reviewLabelsByRequest.set(review.requestId, labels);
  }

  // Denial citations live only in the denial's status_change event. Denied
  // requests are a small subset, so per-request event reads stay bounded.
  const denialCitationsByRequest = new Map<string, string[]>();
  await Promise.all(
    requests
      .filter((r) => r.status === "denied")
      .map(async (r) => {
        const events = await repo.listEvents(agencyId, r.id);
        const denial = events.find(
          (e) =>
            e.kind === "status_change" &&
            (e.payload as { to?: string } | null)?.to === "denied",
        );
        const cited = (denial?.payload as { exemptions?: string[] } | null)?.exemptions;
        if (Array.isArray(cited) && cited.length > 0) {
          denialCitationsByRequest.set(r.id, cited.filter((c): c is string => typeof c === "string"));
        }
      }),
  );

  return {
    records: requests.map((r) => ({
      receivedAt: r.receivedAt ?? r.createdAt,
      closedAt: r.closedAt, // real closure timestamps from the release flow
      statutoryDueAt: r.statutoryDueAt,
      status: r.status,
      requesterType: (r.requesterId && typeById.get(r.requesterId)) || "individual",
      extended: (r.extensionHistory ?? []).length > 0,
      exemptionsCited: citationsFor(
        reviewLabelsByRequest.get(r.id),
        denialCitationsByRequest.get(r.id),
      ),
    })),
    // archive_miss rows are demand signal for the disclosure librarian, not
    // deflections — they never count toward the annual report's ROI number.
    deflections: deflections.filter((d) => d.kind !== "archive_miss").length,
  };
}
