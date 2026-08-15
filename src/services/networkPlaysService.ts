/**
 * The weekly network-plays rebuild (docs/network-plays.md, invariant 11).
 *
 * This is where the invariant's two hardest rules actually live — the pure
 * functions can't enforce either of them, because both are about what the
 * *caller* does:
 *
 *  1. **Contributions are ephemeral.** They exist only as a local `const`
 *     inside this function and are never persisted, logged, cached, or
 *     returned. The aggregate is a public record, so anything stored beside
 *     it can be asked for too — and the contribution set is the one artifact
 *     that would de-anonymize every aggregate built from it. Do not add a
 *     table for them, do not console.log one, do not put one in an error
 *     payload or a job result.
 *  2. **Full replace, one current snapshot.** Never an appended series: a
 *     dated series of aggregates is exactly what a differencing attack
 *     subtracts across. The aggregate is rebuildable from the record at any
 *     time, so keeping history buys nothing and costs anonymity.
 *
 * Plus the stability rule (⚑2): a group whose contributing-agency COUNT
 * changed since the current snapshot is held back for one cycle rather than
 * republished immediately, so a single agency joining or leaving does not
 * hand an observer an instantly diffable before/after pair. Honest limit,
 * recorded here rather than oversold: this raises the cost of differencing,
 * it does not eliminate it — that would take differential privacy, which is
 * out of scope and would blur every number the product is trying to make
 * checkable.
 */
import {
  publishableAggregates,
  toNetworkContribution,
  type NetworkAggregate,
} from "@/domain/networkPlays";
import { getStateProfile } from "@/statute/profiles";
import type { ServiceDeps } from "./deps";
import type { NetworkAggregateEntity } from "./repository";

export interface NetworkRebuildSummary {
  /** Agencies whose admin turned consent on. */
  consentingAgencies: number;
  /** Plays that mapped onto the controlled vocabulary (most will not). */
  contributions: number;
  /** Groups that cleared every floor this cycle. */
  publishable: number;
  /** Groups held back because their agency count moved (stability rule). */
  heldForStability: number;
  /** Rows actually written. */
  published: number;
}

/**
 * Recompute the network aggregates. Safe to run on any deployment: with
 * nobody consenting it writes an empty snapshot and changes nothing
 * observable.
 */
export async function rebuildNetworkAggregates(
  deps: ServiceDeps,
): Promise<NetworkRebuildSummary> {
  const { repo } = deps;
  const agencies = await repo.listAgencies();
  const consenting = agencies.filter((a) => a.settings?.networkPlays?.enabled === true);

  // ── EPHEMERAL ZONE ──────────────────────────────────────────────────────
  // `contributions` names its source agencies and carries exact counts. It
  // must not escape this function in any form.
  const contributions = [];
  for (const agency of consenting) {
    const profile = getStateProfile(agency.stateCode);
    const plays = await repo.listPlays(agency.id);
    for (const play of plays) {
      const contribution = toNetworkContribution(play, {
        // Re-read consent per agency rather than trusting the filter above —
        // the chokepoint should be the thing that decides, always.
        consented: agency.settings?.networkPlays?.enabled === true,
        agencyId: agency.id,
        stateCode: agency.stateCode,
        profileExemptions: profile?.exemptions ?? [],
      });
      if (contribution) contributions.push(contribution);
    }
  }

  const candidates = publishableAggregates(contributions);
  // ── END EPHEMERAL ZONE ──────────────────────────────────────────────────
  // Past this line nothing agency-identifying remains in scope.

  const current = await repo.listNetworkAggregates();
  const currentByKey = new Map(current.map((r) => [`${r.stateCode}::${r.topic}`, r]));

  const { publish, held } = applyStabilityRule(candidates, currentByKey);

  const now = deps.now();
  const rows: NetworkAggregateEntity[] = publish.map(({ aggregate: a, pending }) => ({
    id: deps.genId(),
    stateCode: a.stateCode,
    topic: a.topic,
    agencyCount: a.agencyCount,
    episodes: a.episodes,
    routes: a.routes.map((r) => ({ role: r.role, share: r.share, agencyCount: r.agencyCount })),
    exemptionSections: a.exemptionSections.map((s) => ({ ...s })),
    daysToClose: a.daysToClose,
    extensionRate: a.extensionRate,
    basis: a.basis,
    pendingAgencyCount: pending,
    computedAt: now,
  }));
  await repo.replaceNetworkAggregates(rows);

  return {
    consentingAgencies: consenting.length,
    contributions: contributions.length,
    publishable: candidates.length,
    heldForStability: held,
    published: rows.length,
  };
}

/**
 * Stability rule (⚑2): a group's published numbers move only after its
 * agency count has held steady for a full cycle. A group whose count just
 * moved keeps serving its PREVIOUS row — held, not deleted, so the read side
 * doesn't flicker — and remembers the count it saw so the hold lasts exactly
 * one cycle.
 *
 * THE BOOKKEEPING IS LOAD-BEARING, not incidental. Without
 * `pendingAgencyCount` this rule livelocks: it would re-publish the old row,
 * compare the unchanged stored count against the new candidate next week,
 * hold again, and freeze the benchmark permanently the first time an agency
 * joined. (Caught by the "publishes after membership settles" test — keep
 * that test.)
 *
 * Note what is deliberately NOT compared: the identity of the contributing
 * SET. A fingerprint of it would be a stronger signal and would also be
 * brute-forceable back to its members against a known tenant list, undoing
 * the anonymity the floors provide. A weaker safe signal beats a stronger
 * leaky one — a membership change that preserves the count slips through,
 * and that is the accepted cost.
 */
function applyStabilityRule(
  candidates: NetworkAggregate[],
  currentByKey: Map<string, NetworkAggregateEntity>,
): { publish: { aggregate: NetworkAggregate; pending: number | null }[]; held: number } {
  const publish: { aggregate: NetworkAggregate; pending: number | null }[] = [];
  let held = 0;

  for (const candidate of candidates) {
    const key = `${candidate.stateCode}::${candidate.topic}`;
    const previous = currentByKey.get(key);

    // First publication for this group — nothing to difference against yet.
    if (!previous) {
      publish.push({ aggregate: candidate, pending: null });
      continue;
    }
    // Membership unchanged — safe to move the numbers.
    if (previous.agencyCount === candidate.agencyCount) {
      publish.push({ aggregate: candidate, pending: null });
      continue;
    }
    // The count moved. If we already held for THIS count last cycle, it has
    // now been stable for a full cycle: publish.
    if (previous.pendingAgencyCount === candidate.agencyCount) {
      publish.push({ aggregate: candidate, pending: null });
      continue;
    }
    // Otherwise hold one cycle, remembering the count we are waiting on.
    held += 1;
    publish.push({ aggregate: entityToAggregate(previous), pending: candidate.agencyCount });
  }
  return { publish, held };
}

/** Re-express a stored row as an aggregate so a held group can be re-written
 *  unchanged (full-replace means every surviving row must be re-inserted). */
function entityToAggregate(row: NetworkAggregateEntity): NetworkAggregate {
  return {
    stateCode: row.stateCode,
    topic: row.topic as NetworkAggregate["topic"],
    agencyCount: row.agencyCount,
    episodes: row.episodes as NetworkAggregate["episodes"],
    routes: row.routes as NetworkAggregate["routes"],
    exemptionSections: row.exemptionSections,
    daysToClose: row.daysToClose as NetworkAggregate["daysToClose"],
    extensionRate: row.extensionRate as NetworkAggregate["extensionRate"],
    basis: row.basis,
  };
}

/**
 * Read side, gated by contribute-to-read (⚑1): an agency sees the network
 * only if it is part of it. Returns [] for a non-consenting agency — not an
 * error, just nothing, so callers need no special case.
 */
export async function listNetworkAggregatesFor(
  deps: ServiceDeps,
  agencyId: string,
): Promise<NetworkAggregateEntity[]> {
  const agency = await deps.repo.getAgency(agencyId);
  if (agency?.settings?.networkPlays?.enabled !== true) return [];
  const all = await deps.repo.listNetworkAggregates();
  // Same-state comparisons only — statutes differ, so cross-state numbers
  // would compare offices operating under different clocks and exemptions.
  return all.filter((a) => a.stateCode === agency.stateCode);
}
