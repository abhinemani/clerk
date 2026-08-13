/**
 * Case learning (docs/learning-loop.md) — the pure core of the loop that
 * turns resolved requests into institutional knowledge.
 *
 * Three stages, all deterministic, no model, no clock:
 *   1. distillEpisode — one closed request + its tasks/reviews → a compact
 *      CaseEpisode (what was asked, who produced it, what was withheld and
 *      why, how long it took, how it ended).
 *   2. buildPlaybooks — cluster episodes by ask-term overlap (same greedy
 *      profile clustering as demandPatterns) and aggregate each cluster's
 *      resolution statistics into a Playbook.
 *   3. matchPlaybook / routingSuggestionFrom — match a NEW ask against the
 *      learned clusters, and convert a playbook's route history into a
 *      routing suggestion whose confidence is EARNED: share of episodes that
 *      went to that department, discounted until the cluster has enough
 *      evidence, and hard-capped below 1.0 (explicit agency rules own 1.0).
 *
 * The distinction from RAG: prompts get precedents as text; this layer gets
 * STRUCTURE — histograms, medians, rates — that works with zero API keys and
 * feeds the existing auto-dispatch gate with numbers a coordinator can audit.
 */
import type { PlaybookStats } from "@/db/schema";
import type { RequestEntity, ReviewEntity, TaskEntity } from "@/services/repository";
import { demandTerms } from "./demandPatterns";

export interface CaseEpisode {
  requestId: string;
  publicId: string;
  /** Term profile of the ask (interpreted scope when present, else raw text). */
  terms: Set<string>;
  /** Departments whose tasks actually completed ("done"), by name. */
  routes: { departmentId: string | null; department: string }[];
  /** Exemption labels cited in this request's reviews. */
  exemptions: string[];
  outcome: string;
  daysToClose: number | null;
  tookExtension: boolean;
  closedAt: Date;
}

/** Distill one CLOSED request into an episode; null if it can't teach us anything. */
export function distillEpisode(
  request: RequestEntity,
  tasks: TaskEntity[],
  reviews: ReviewEntity[],
  departmentNameById: Map<string, string>,
): CaseEpisode | null {
  if (!request.closedAt) return null;
  const text = request.interpretedScope ?? request.rawText;
  const terms = demandTerms(text);
  if (terms.size === 0) return null;

  const routes = tasks
    .filter((t) => t.requestId === request.id && t.status === "done")
    .map((t) => ({
      departmentId: t.departmentId,
      department: t.departmentId ? (departmentNameById.get(t.departmentId) ?? "Unknown department") : "Unassigned",
    }));

  const exemptions = reviews
    .filter((r) => r.requestId === request.id && r.exemptionLabel)
    .map((r) => r.exemptionLabel!);

  const received = request.receivedAt ?? request.createdAt;
  const days = Math.round((request.closedAt.getTime() - received.getTime()) / 86_400_000);

  return {
    requestId: request.id,
    publicId: request.publicId,
    terms,
    routes,
    exemptions,
    outcome: request.status,
    daysToClose: days >= 0 ? days : null,
    tookExtension: (request.extensionHistory?.length ?? 0) > 0,
    closedAt: request.closedAt,
  };
}

export interface Playbook {
  topic: string;
  keywords: string[];
  episodeCount: number;
  stats: PlaybookStats;
}

const OVERLAP_THRESHOLD = 0.5;

function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  const smaller = Math.min(a.size, b.size);
  return smaller === 0 ? 0 : shared / smaller;
}

interface Cluster {
  members: CaseEpisode[];
  termCounts: Map<string, number>;
}

function clusterProfile(cluster: Cluster): Set<string> {
  const half = cluster.members.length / 2;
  const profile = new Set<string>();
  for (const [t, n] of cluster.termCounts) if (n >= half) profile.add(t);
  return profile;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * Cluster episodes (oldest-first for stable results) and aggregate each
 * cluster into a playbook. Singleton clusters are kept from minEpisodes=2 up —
 * one case is an anecdote, two is the start of a pattern.
 */
export function buildPlaybooks(
  episodes: CaseEpisode[],
  opts: { minEpisodes?: number; maxPlaybooks?: number } = {},
): Playbook[] {
  const minEpisodes = opts.minEpisodes ?? 2;
  const maxPlaybooks = opts.maxPlaybooks ?? 20;

  const clusters: Cluster[] = [];
  for (const ep of episodes) {
    let best: Cluster | null = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      const score = overlap(ep.terms, clusterProfile(cluster));
      if (score >= OVERLAP_THRESHOLD && score > bestScore) {
        best = cluster;
        bestScore = score;
      }
    }
    if (best) {
      best.members.push(ep);
      for (const t of ep.terms) best.termCounts.set(t, (best.termCounts.get(t) ?? 0) + 1);
    } else {
      clusters.push({ members: [ep], termCounts: new Map([...ep.terms].map((t) => [t, 1])) });
    }
  }

  const playbooks: Playbook[] = [];
  for (const cluster of clusters) {
    if (cluster.members.length < minEpisodes) continue;
    const half = cluster.members.length / 2;
    const keywords = [...cluster.termCounts.entries()]
      .filter(([, n]) => n >= half)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t]) => t)
      .slice(0, 6);
    if (keywords.length === 0) continue;

    // Route histogram: share of episodes whose completed tasks include the
    // department (an episode with two departments counts toward both).
    const routeCounts = new Map<string, { departmentId: string | null; department: string; n: number }>();
    for (const ep of cluster.members) {
      const seen = new Set<string>();
      for (const r of ep.routes) {
        const key = r.departmentId ?? r.department;
        if (seen.has(key)) continue;
        seen.add(key);
        const row = routeCounts.get(key) ?? { departmentId: r.departmentId, department: r.department, n: 0 };
        row.n += 1;
        routeCounts.set(key, row);
      }
    }
    const routes = [...routeCounts.values()]
      .map((r) => ({
        departmentId: r.departmentId,
        department: r.department,
        share: Math.round((r.n / cluster.members.length) * 100) / 100,
      }))
      .sort((a, b) => b.share - a.share || a.department.localeCompare(b.department));

    const exemptionCounts = new Map<string, number>();
    for (const ep of cluster.members) {
      for (const label of new Set(ep.exemptions)) {
        exemptionCounts.set(label, (exemptionCounts.get(label) ?? 0) + 1);
      }
    }

    const outcomes: Record<string, number> = {};
    for (const ep of cluster.members) outcomes[ep.outcome] = (outcomes[ep.outcome] ?? 0) + 1;

    const newestFirst = [...cluster.members].sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime());

    playbooks.push({
      topic: keywords.slice(0, 3).join(" "),
      keywords,
      episodeCount: cluster.members.length,
      stats: {
        routes,
        exemptions: [...exemptionCounts.entries()]
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
        outcomes,
        medianDaysToClose: median(
          cluster.members.map((e) => e.daysToClose).filter((d): d is number => d != null),
        ),
        extensionRate:
          Math.round((cluster.members.filter((e) => e.tookExtension).length / cluster.members.length) * 100) / 100,
        samplePublicIds: newestFirst.slice(0, 5).map((e) => e.publicId),
      },
    });
  }

  return playbooks.sort((a, b) => b.episodeCount - a.episodeCount).slice(0, maxPlaybooks);
}

export interface PlaybookMatch<P extends Playbook> {
  playbook: P;
  /** Overlap score of the new ask against the playbook's term profile (0–1). */
  score: number;
}

/** Match a new ask against the learned clusters; null when nothing clears the bar. */
export function matchPlaybook<P extends Playbook>(playbooks: P[], text: string): PlaybookMatch<P> | null {
  const terms = demandTerms(text);
  if (terms.size === 0) return null;
  let best: PlaybookMatch<P> | null = null;
  for (const p of playbooks) {
    const score = overlap(terms, new Set(p.keywords));
    if (score >= OVERLAP_THRESHOLD && (best == null || score > best.score)) {
      best = { playbook: p, score };
    }
  }
  return best;
}

/** Evidence needed before a playbook route reaches full (capped) confidence. */
const FULL_EVIDENCE_EPISODES = 5;
/** Explicit agency rules dispatch at 1.0; learned routes never reach it. */
const CONFIDENCE_CAP = 0.9;

export interface LearnedRoutingSuggestion {
  departmentId: string;
  department: string;
  confidence: number;
  rationale: string;
}

/**
 * A playbook's strongest route as an auto-dispatch-shaped suggestion.
 * Confidence = route share × evidence discount, capped at 0.9 — an agency
 * that wants learned routes to auto-dispatch sets its threshold at or below
 * that, knowing the number is a measured agreement rate, not a model vibe.
 */
export function routingSuggestionFrom(playbook: Playbook): LearnedRoutingSuggestion | null {
  const top = playbook.stats.routes[0];
  if (!top?.departmentId) return null;
  const evidence = Math.min(1, playbook.episodeCount / FULL_EVIDENCE_EPISODES);
  const confidence = Math.round(Math.min(CONFIDENCE_CAP, top.share * evidence) * 100) / 100;
  if (confidence <= 0) return null;
  return {
    departmentId: top.departmentId,
    department: top.department,
    confidence,
    rationale: `${Math.round(top.share * 100)}% of ${playbook.episodeCount} similar past request(s) ("${playbook.topic}") were fulfilled by ${top.department}`,
  };
}
