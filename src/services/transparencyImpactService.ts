/**
 * Transparency impact service (docs/transparency-impact.md): repo-fed half
 * of src/domain/transparencyImpact.ts — the reports page's one loader for
 * the north-star section. Deterministic, no model, no keys.
 */
import { mineDemandPatterns } from "@/domain/demandPatterns";
import {
  demandSignalsFrom,
  monthlyImpact,
  projectOpportunities,
  type MonthlyImpactRow,
  type PublicationOpportunity,
} from "@/domain/transparencyImpact";
import type { Repository } from "./repository";

export interface TransparencyImpact {
  monthly: MonthlyImpactRow[];
  opportunities: PublicationOpportunity[];
  totals: {
    hoursAvoidedAllTime: number;
    deflectionsAllTime: number;
    publishedRecords: number;
  };
}

export async function transparencyImpact(
  repo: Repository,
  agencyId: string,
  now: Date,
): Promise<TransparencyImpact> {
  const [requests, deflections, publicDocs] = await Promise.all([
    repo.listRequests(agencyId),
    repo.listDeflections(agencyId),
    repo.listPublicDocuments(agencyId),
  ]);

  const real = deflections.filter((d) => d.kind !== "archive_miss"); // never ROI
  return {
    monthly: monthlyImpact({ requests, deflections, publishedDocs: publicDocs, now }),
    opportunities: projectOpportunities(
      mineDemandPatterns(demandSignalsFrom(requests, deflections), { now }),
    ),
    totals: {
      hoursAvoidedAllTime:
        Math.round(real.reduce((s, d) => s + d.estimatedStaffHoursAvoided, 0) * 10) / 10,
      deflectionsAllTime: real.length,
      publishedRecords: publicDocs.length,
    },
  };
}
