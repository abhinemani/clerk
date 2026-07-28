/**
 * Deflection logging (spec §6.7): "Every deflection ... is logged as a Deflection
 * event with the estimated staff-hours avoided — this is the ROI number agencies
 * show their councils."
 */
import type { ServiceDeps } from "./deps";
import type { DeflectionEntity } from "./repository";

/** Rough staff-hours a records office avoids per deflection type. */
const HOURS_AVOIDED: Record<DeflectionEntity["kind"], number> = {
  download: 1.5, // a full request that never needed to be filed
  scope_down: 0.5, // a request that got narrower/faster
};

export async function logDeflection(
  deps: ServiceDeps,
  input: { agencyId: string; kind: DeflectionEntity["kind"]; query?: string; documentId?: string },
): Promise<DeflectionEntity> {
  return deps.repo.appendDeflection({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: input.kind,
    query: input.query ?? null,
    documentId: input.documentId ?? null,
    estimatedStaffHoursAvoided: HOURS_AVOIDED[input.kind],
    createdAt: deps.now(),
  });
}

export interface DeflectionSummary {
  count: number;
  downloads: number;
  scopeDowns: number;
  staffHoursAvoided: number;
}

export async function deflectionSummary(deps: ServiceDeps, agencyId: string): Promise<DeflectionSummary> {
  const all = await deps.repo.listDeflections(agencyId);
  return {
    count: all.length,
    downloads: all.filter((d) => d.kind === "download").length,
    scopeDowns: all.filter((d) => d.kind === "scope_down").length,
    staffHoursAvoided: Math.round(all.reduce((s, d) => s + d.estimatedStaffHoursAvoided, 0) * 10) / 10,
  };
}
