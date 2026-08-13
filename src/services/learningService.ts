/**
 * The learning loop (docs/learning-loop.md) — resolved requests make the
 * platform smarter, structurally, not just as RAG context.
 *
 * rebuildAgencyPlaybooks: nightly (and cheap — four agency-wide queries, no
 * per-request reads), distills every CLOSED request into an episode and
 * re-clusters them into playbooks, replacing the agency's rows wholesale. A
 * materialized aggregate of the append-only record: it can be dropped and
 * rebuilt at any time and can never drift from the truth it summarizes.
 *
 * applyPlaybookRouting: at filing time, match the new ask against the learned
 * clusters. A match writes ONE proposal-card event (the same shape rules and
 * the AI pipeline write, so staff review all three identically) and hands the
 * suggestion to the SAME auto-dispatch gate — with confidence EARNED from
 * history (share × evidence, capped at 0.9; explicit rules own 1.0). Runs
 * with zero API keys: this is statistics over the agency's own record.
 */
import {
  buildPlaybooks,
  distillEpisode,
  matchPlaybook,
  routingSuggestionFrom,
  type CaseEpisode,
  type PlaybookMatch,
} from "@/domain/caseLearning";
import type { ServiceDeps } from "./deps";
import type { PlaybookEntity } from "./repository";
import { autoDispatchSuggestions, type AutoDispatchResult } from "./taskService";

export async function rebuildAgencyPlaybooks(
  deps: ServiceDeps,
  agencyId: string,
): Promise<{ playbooks: number; episodes: number }> {
  const { repo } = deps;
  const [requests, tasks, reviews, departments] = await Promise.all([
    repo.listRequests(agencyId),
    repo.listAgencyTasks(agencyId),
    repo.listAgencyReviews(agencyId),
    repo.listDepartments(agencyId),
  ]);
  const deptNameById = new Map(departments.map((d) => [d.id, d.name]));

  const episodes: CaseEpisode[] = [];
  for (const request of requests) {
    const ep = distillEpisode(request, tasks, reviews, deptNameById);
    if (ep) episodes.push(ep);
  }
  // Oldest-first for stable clustering across rebuilds.
  episodes.sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());

  const built = buildPlaybooks(episodes);
  const rows: PlaybookEntity[] = built.map((p) => ({
    id: deps.genId(),
    agencyId,
    topic: p.topic,
    keywords: p.keywords,
    stats: p.stats,
    episodeCount: p.episodeCount,
    rebuiltAt: deps.now(),
    createdAt: deps.now(),
  }));
  await repo.replaceAgencyPlaybooks(agencyId, rows);
  return { playbooks: rows.length, episodes: episodes.length };
}

/** Match a new ask against the agency's learned playbooks (read-only). */
export async function consultPlaybooks(
  deps: ServiceDeps,
  input: { agencyId: string; text: string },
): Promise<PlaybookMatch<PlaybookEntity> | null> {
  const playbooks = await deps.repo.listPlaybooks(input.agencyId);
  if (playbooks.length === 0) return null;
  return matchPlaybook(playbooks, input.text);
}

/**
 * Learned routing at filing time. Ordering contract with the caller: run
 * AFTER applyAgencyRoutingRules — explicit agency policy outranks learned
 * history, and autoDispatchSuggestions' own "tasks already exist" guard then
 * makes the learned pass advisory-only whenever a rule already dispatched.
 */
export async function applyPlaybookRouting(
  deps: ServiceDeps,
  input: { agencyId: string; requestId: string; rawText: string },
): Promise<AutoDispatchResult & { suggested: number }> {
  const match = await consultPlaybooks(deps, { agencyId: input.agencyId, text: input.rawText });
  if (!match) return { suggested: 0, dispatched: 0, heldForReview: 0, reason: "no playbook matched" };

  const suggestion = routingSuggestionFrom(match.playbook);
  const { stats } = match.playbook;

  // Always record the match — the advisory (timing, exemption patterns,
  // precedents) is worth a card even when no route clears the bar.
  await deps.repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: input.requestId,
    kind: "ai_action",
    actorUserId: null,
    summary: `Playbook match: ${match.playbook.episodeCount} similar past request(s) ("${match.playbook.topic}")`,
    payload: {
      pipeline: "playbook_routing",
      topic: match.playbook.topic,
      score: Math.round(match.score * 100) / 100,
      episodes: match.playbook.episodeCount,
      medianDaysToClose: stats.medianDaysToClose,
      extensionRate: stats.extensionRate,
      exemptions: stats.exemptions.slice(0, 3),
      samplePublicIds: stats.samplePublicIds,
      suggestions: suggestion
        ? [
            {
              departmentId: suggestion.departmentId,
              department: suggestion.department,
              scope: `Locate records responsive to: "${input.rawText.trim().slice(0, 400)}"`,
              rationale: suggestion.rationale,
              confidence: suggestion.confidence,
            },
          ]
        : [],
    },
    createdAt: deps.now(),
  });

  if (!suggestion) return { suggested: 0, dispatched: 0, heldForReview: 0, reason: "no learned route" };

  const result = await autoDispatchSuggestions(deps, {
    agencyId: input.agencyId,
    requestId: input.requestId,
    suggestions: [
      {
        departmentId: suggestion.departmentId,
        department: suggestion.department,
        scope: `Locate records responsive to: "${input.rawText.trim().slice(0, 400)}"`,
        confidence: suggestion.confidence,
      },
    ],
  });
  return { ...result, suggested: 1 };
}
