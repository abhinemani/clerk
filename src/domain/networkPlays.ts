/**
 * Network plays — the two pure functions that carry invariant 11
 * (docs/network-plays.md). No I/O, no clock, config as arguments: the
 * computeDueDate() pattern applied to a privacy rule, so the whole
 * enforcement surface is exhaustively testable with zero schema.
 *
 * These are a CHOKEPOINT, not a helper. The only path from a tenant's plays
 * to anything another tenant can read runs through:
 *
 *     play ──toNetworkContribution──▶ NetworkContribution (platform-internal)
 *                                          │
 *                                          ▼
 *              publishableAggregates ──▶ NetworkAggregate (tenant-readable)
 *
 * Two boundaries, deliberately distinct:
 *  - A **contribution** carries an exact episodeCount and its agencyId
 *    because you cannot enforce a population floor without counting the
 *    population. It is platform-internal and MUST NEVER be served to a
 *    tenant.
 *  - An **aggregate** is what a tenant reads. It carries no agency
 *    identifier and no exact per-agency count, ever.
 *
 * Consent is checked INSIDE the projection rather than by the caller, so
 * there is no way to produce a contribution from a non-consenting agency
 * even by mistake.
 */
import {
  toDepartmentRole,
  toStatuteSection,
  toTopicCode,
  type DepartmentRole,
  type TopicCode,
} from "./networkVocabulary";

// --- floors (invariant 11; values set by the owner 2026-08-15) -------------

/** Distinct consenting agencies required before anything publishes. */
export const MIN_AGENCIES = 5;
/** Total episodes behind a published aggregate. */
export const MIN_EPISODES = 20;
/** No single agency may be more than this share of an aggregate's episodes. */
export const MAX_AGENCY_SHARE = 0.4;
/**
 * Implementation floor, STRICTER than the invariant requires (being stricter
 * never violates a floor): a routed role publishes only with at least this
 * many distinct agencies behind it, which kills singleton noise.
 * Exemption sections use the full MIN_AGENCIES instead — see
 * publishableAggregates for why the two differ.
 */
export const MIN_ROUTE_AGENCIES = 2;

// --- buckets ---------------------------------------------------------------
// Exact values are what differencing attacks subtract. Everything numeric
// that reaches a tenant is bucketed.

export type DaysBucket = "0-3" | "4-7" | "8-14" | "15-30" | "31-60" | "60+";
export type RateBucket = "0-10%" | "10-25%" | "25-50%" | "50%+";
export type ShareBucket = "<25%" | "25-49%" | "50-74%" | "75-89%" | "90%+";
export type EpisodeBucket = "20-49" | "50-99" | "100-499" | "500+";

export function daysBucket(days: number | null): DaysBucket | null {
  if (days == null || !Number.isFinite(days) || days < 0) return null;
  if (days <= 3) return "0-3";
  if (days <= 7) return "4-7";
  if (days <= 14) return "8-14";
  if (days <= 30) return "15-30";
  if (days <= 60) return "31-60";
  return "60+";
}

export function rateBucket(rate: number): RateBucket {
  const r = Math.min(Math.max(rate, 0), 1);
  if (r < 0.1) return "0-10%";
  if (r < 0.25) return "10-25%";
  if (r < 0.5) return "25-50%";
  return "50%+";
}

export function shareBucket(share: number): ShareBucket {
  const s = Math.min(Math.max(share, 0), 1);
  if (s < 0.25) return "<25%";
  if (s < 0.5) return "25-49%";
  if (s < 0.75) return "50-74%";
  if (s < 0.9) return "75-89%";
  return "90%+";
}

export function episodeBucket(n: number): EpisodeBucket {
  if (n < 50) return "20-49";
  if (n < 100) return "50-99";
  if (n < 500) return "100-499";
  return "500+";
}

// --- types -----------------------------------------------------------------

/** The play fields this projection is allowed to look at. Deliberately a
 *  narrow structural slice, so it cannot accidentally read raw text. */
export interface ProjectablePlay {
  keywords: string[];
  episodeCount: number;
  stats: {
    routes: { department: string; share: number }[];
    exemptions: { label: string; count: number }[];
    medianDaysToClose: number | null;
    extensionRate: number;
  };
}

export interface ProjectionContext {
  /** Invariant 11: no contribution without a recorded, revocable opt-in. */
  consented: boolean;
  agencyId: string;
  stateCode: string;
  /** The agency's own statute profile — the canonical section allowlist. */
  profileExemptions: readonly { statuteSection: string; shortLabel: string }[];
}

/**
 * EPHEMERAL AND PLATFORM-INTERNAL — invariant 11.
 *
 * This is the only artifact that names its source agency AND carries an
 * exact count, both required for floor math and both de-anonymizing. It
 * must be computed in memory and **never persisted, logged, cached, or
 * exported**: the aggregate it feeds is a public record (owner's counsel
 * position, 2026-08-15), so anything stored next to that aggregate can be
 * asked for too, and a stored contribution set would reverse the anonymity
 * of every aggregate built from it.
 *
 * The guarantee must be that this data does not exist at rest — not that we
 * decline to serve it. If you find yourself adding a `network_contributions`
 * table, a debug dump, or an error log that includes one of these, that is
 * the invariant breaking.
 */
export interface NetworkContribution {
  agencyId: string;
  stateCode: string;
  topic: TopicCode;
  episodeCount: number;
  routes: { role: DepartmentRole; share: number }[];
  exemptionSections: string[];
  daysToClose: DaysBucket | null;
  extensionRate: RateBucket;
}

/** TENANT-READABLE. No agency identifier, no exact per-agency count. */
export interface NetworkAggregate {
  stateCode: string;
  topic: TopicCode;
  agencyCount: number;
  episodes: EpisodeBucket;
  routes: { role: DepartmentRole; share: ShareBucket; agencyCount: number }[];
  exemptionSections: { section: string; agencyCount: number }[];
  daysToClose: DaysBucket | null;
  extensionRate: RateBucket | null;
  /** Checkable sentence — the computeDueDate/tabular-answer `basis` idiom. */
  basis: string;
}

// --- (1) projection --------------------------------------------------------

/**
 * Project one agency's play into a network contribution, or null.
 *
 * Returns null — contributing NOTHING — when the agency hasn't consented,
 * or when the play cannot be mapped onto the controlled vocabulary. Null is
 * the expected outcome for most plays early on; see networkVocabulary.
 */
export function toNetworkContribution(
  play: ProjectablePlay,
  ctx: ProjectionContext,
): NetworkContribution | null {
  if (!ctx.consented) return null; // invariant 11, checked at the chokepoint
  if (!Number.isFinite(play.episodeCount) || play.episodeCount <= 0) return null;

  const topic = toTopicCode(play.keywords);
  if (!topic) return null; // unmappable → dropped, never passed through

  const stateCode = ctx.stateCode.trim().toUpperCase();
  if (stateCode.length !== 2) return null;

  // Routes: tenant department NAMES become platform roles, or vanish. Shares
  // for the same role merge (two "Streets"/"Sanitation" departments are one
  // public_works to the network).
  const byRole = new Map<DepartmentRole, number>();
  for (const r of play.stats.routes) {
    const role = toDepartmentRole(r.department);
    if (!role) continue;
    const share = Math.min(Math.max(r.share, 0), 1);
    if (share <= 0) continue;
    byRole.set(role, (byRole.get(role) ?? 0) + share);
  }
  const routes = [...byRole.entries()]
    .map(([role, share]) => ({ role, share: Math.min(share, 1) }))
    .sort((a, b) => b.share - a.share || a.role.localeCompare(b.role));

  // Exemptions: staff-authored labels become canonical sections, or vanish.
  const sections = new Set<string>();
  for (const e of play.stats.exemptions) {
    const section = toStatuteSection(e.label, ctx.profileExemptions);
    if (section) sections.add(section);
  }

  return {
    agencyId: ctx.agencyId,
    stateCode,
    topic,
    episodeCount: play.episodeCount,
    routes,
    exemptionSections: [...sections].sort(),
    daysToClose: daysBucket(play.stats.medianDaysToClose),
    extensionRate: rateBucket(play.stats.extensionRate),
  };
}

// --- (2) publication -------------------------------------------------------

/** Most common value, ties broken by the buckets' natural order. */
function modal<T extends string>(values: T[], order: readonly T[]): T | null {
  if (values.length === 0) return null;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const candidate of order) {
    const n = counts.get(candidate) ?? 0;
    if (n > bestCount) {
      best = candidate;
      bestCount = n;
    }
  }
  return best;
}

const DAYS_ORDER: readonly DaysBucket[] = ["0-3", "4-7", "8-14", "15-30", "31-60", "60+"];
const RATE_ORDER: readonly RateBucket[] = ["0-10%", "10-25%", "25-50%", "50%+"];

/**
 * Group contributions into publishable aggregates, withholding anything that
 * fails a floor.
 *
 * SUPPRESSION IS THE ONLY RESPONSE TO A THIN CELL (invariant 11). Nothing is
 * rounded, padded, blurred, or partially disclosed into existence: a group
 * that misses a floor produces NO aggregate at all.
 *
 * One contribution per (agency, topic) is assumed; duplicates from the same
 * agency are merged so an agency cannot inflate its own weight.
 */
export function publishableAggregates(
  contributions: readonly NetworkContribution[],
): NetworkAggregate[] {
  // Group by comparability unit: same state, same topic.
  const groups = new Map<string, NetworkContribution[]>();
  for (const c of contributions) {
    const key = `${c.stateCode}::${c.topic}`;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  const out: NetworkAggregate[] = [];
  for (const [, group] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Merge duplicates per agency — an agency counts once, however many rows
    // it submitted.
    const byAgency = new Map<string, NetworkContribution>();
    for (const c of group) {
      const prev = byAgency.get(c.agencyId);
      if (!prev) byAgency.set(c.agencyId, c);
      else if (c.episodeCount > prev.episodeCount) byAgency.set(c.agencyId, c);
    }
    const members = [...byAgency.values()];

    // FLOOR 1 — distinct consenting agencies.
    if (members.length < MIN_AGENCIES) continue;

    // FLOOR 2 — total episodes.
    const totalEpisodes = members.reduce((n, c) => n + c.episodeCount, 0);
    if (totalEpisodes < MIN_EPISODES) continue;

    // FLOOR 3 — dominance: "5 agencies" must not mean "one agency and four
    // rounding errors".
    const maxShare = Math.max(...members.map((c) => c.episodeCount)) / totalEpisodes;
    if (maxShare > MAX_AGENCY_SHARE) continue;

    const first = members[0]!;

    // Routes: rank by summed share, but publish only roles with enough
    // distinct agencies behind them.
    const roleTotals = new Map<DepartmentRole, { share: number; agencies: number }>();
    for (const m of members) {
      for (const r of m.routes) {
        const cur = roleTotals.get(r.role) ?? { share: 0, agencies: 0 };
        cur.share += r.share;
        cur.agencies += 1;
        roleTotals.set(r.role, cur);
      }
    }
    const routes = [...roleTotals.entries()]
      .filter(([, v]) => v.agencies >= MIN_ROUTE_AGENCIES)
      .map(([role, v]) => ({
        role,
        share: shareBucket(v.share / members.length),
        agencyCount: v.agencies,
      }))
      .sort((a, b) => b.agencyCount - a.agencyCount || a.role.localeCompare(b.role));

    // Exemption sections get the FULL agency floor, not the lighter route
    // floor. Routing consensus ("permits go to public works") is generic and
    // barely disclosive; exemption practice is the litigation-sensitive
    // number this whole design is cautious about, so no small group of
    // agencies may become the published norm.
    const sectionAgencies = new Map<string, number>();
    for (const m of members) {
      for (const s of m.exemptionSections) {
        sectionAgencies.set(s, (sectionAgencies.get(s) ?? 0) + 1);
      }
    }
    const exemptionSections = [...sectionAgencies.entries()]
      .filter(([, n]) => n >= MIN_AGENCIES)
      .map(([section, agencyCount]) => ({ section, agencyCount }))
      .sort((a, b) => b.agencyCount - a.agencyCount || a.section.localeCompare(b.section));

    const days = modal(
      members.map((m) => m.daysToClose).filter((d): d is DaysBucket => d != null),
      DAYS_ORDER,
    );
    const rate = modal(members.map((m) => m.extensionRate), RATE_ORDER);

    out.push({
      stateCode: first.stateCode,
      topic: first.topic,
      agencyCount: members.length,
      episodes: episodeBucket(totalEpisodes),
      routes,
      exemptionSections,
      daysToClose: days,
      extensionRate: rate,
      basis: `Across ${members.length} consenting ${first.stateCode} agencies and ${episodeBucket(totalEpisodes)} closed requests. Aggregated under invariant 11 — no agency is identifiable and no agency contributed more than ${Math.round(MAX_AGENCY_SHARE * 100)}% of it.`,
    });
  }
  return out;
}

// --- (3) read side: the ranking rule ---------------------------------------

/**
 * A network routing hint. DELIBERATELY NOT `LearnedRoutingSuggestion`.
 *
 * Invariant 11 says a network signal may never auto-dispatch on its own. A
 * numeric cap cannot guarantee that — an agency may set
 * autoDispatchConfidence as low as it likes (default 0.8, but 0.5 is
 * permitted), so any value we pick could clear somebody's bar. The guarantee
 * is therefore STRUCTURAL: this is a distinct type that `autoDispatchSuggestions`
 * does not accept, so routing a network hint into the dispatch path is a
 * compile error rather than a policy violation. `confidence` is for display
 * ranking only.
 */
export interface NetworkRoutingHint {
  role: DepartmentRole;
  /** Display-only, capped below the local learned-play cap (0.9): other
   *  agencies' history is real evidence, but weaker than your own. */
  confidence: number;
  basis: string;
}

/** Ceiling for a network hint's displayed confidence (local plays cap at 0.9). */
export const NETWORK_CONFIDENCE_CAP = 0.6;

export function networkRoutingHint(aggregate: NetworkAggregate): NetworkRoutingHint | null {
  const top = aggregate.routes[0];
  if (!top) return null;
  // Evidence scales with how many agencies agree, never past the cap.
  const evidence = Math.min(1, top.agencyCount / MIN_AGENCIES);
  const confidence = Math.round(Math.min(NETWORK_CONFIDENCE_CAP, evidence * NETWORK_CONFIDENCE_CAP) * 100) / 100;
  if (confidence <= 0) return null;
  return {
    role: top.role,
    confidence,
    basis: `${top.agencyCount} of ${aggregate.agencyCount} ${aggregate.stateCode} agencies route this to ${top.role} (${top.share}). ${aggregate.basis}`,
  };
}
