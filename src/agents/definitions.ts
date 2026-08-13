/**
 * The five agents (spec §16.1) as declarative definitions.
 *
 * Each agent is a configuration over the shared framework — an explicit
 * capability allowlist ("nothing else", §16.2), a retrieval scope, and default
 * budget caps. No agent has capabilities beyond its allowlist; the orchestrator
 * blocks anything off-list as misbehavior.
 */
import type { AgentBudgetLimits } from "./budget";
import { DEFAULT_BUDGET } from "./budget";
import type { CapabilityName } from "./tools";

export type AgentTypeName =
  | "fulfillment"
  | "deadline"
  | "release_prep"
  | "ingest_steward"
  | "requester_side"
  | "disclosure_librarian"; // Phase 5 B1 (gate released 2026-08-13)

export type AgentScope = "per_request" | "queue_wide" | "data_plane" | "portal_session";

export interface AgentDefinition {
  type: AgentTypeName;
  title: string;
  description: string;
  scope: AgentScope;
  /** "public" hard-pins retrieval to the public corpus (§16.3); "full" = staff scope. */
  corpusScope: "public" | "full";
  /** The complete set of capabilities this agent may invoke — its tool surface. */
  allowedCapabilities: Set<CapabilityName>;
  defaultBudget: AgentBudgetLimits;
}

/**
 * Fulfillment agent (per-request) — "works a request like a junior clerk":
 * decompose scope → search corpus/connectors → propose tasks → monitor tasks →
 * assemble a candidate review set → write a status memo.
 */
const fulfillment: AgentDefinition = {
  type: "fulfillment",
  title: "Fulfillment agent",
  description:
    "Decomposes an interpreted request scope into a search plan, runs corpus and connector searches, proposes department tasks for gaps, monitors task completion, assembles a candidate review set, and writes a status memo.",
  scope: "per_request",
  corpusScope: "full",
  allowedCapabilities: new Set<CapabilityName>([
    "read_request",
    "read_events",
    "read_documents",
    "read_task_status",
    "corpus_search",
    "connector_search",
    "propose_task",
    "dispatch_task", // gated: emailing a responder is Tier 2
    "assemble_review_set",
    "draft_message",
    "create_extension_draft",
    "status_memo",
    "plan_update",
  ]),
  defaultBudget: DEFAULT_BUDGET,
};

/**
 * Deadline agent (queue-wide, cron-driven). Spec's tightest allowlist example:
 * "read queue, draft message, send tier-1 nudge, create draft extension — nothing
 * else." We also include the Tier-2 custodian/staff nudge emails it may auto-send
 * *per agency policy* (§16.1), which remain human-gated unless opted in (§16.3),
 * plus the morning-digest status memo.
 */
const deadline: AgentDefinition = {
  type: "deadline",
  title: "Deadline agent",
  description:
    "Nightly sweep of open requests: computes deadline risk, nudges unresponsive custodians, pre-drafts extension notices before deadlines blow, and produces the coordinator's morning digest.",
  scope: "queue_wide",
  corpusScope: "full",
  allowedCapabilities: new Set<CapabilityName>([
    "read_queue",
    "read_request",
    "compute_deadline_risk",
    "draft_message",
    "internal_nudge", // Tier 1: in-app nudge
    "send_custodian_nudge_email", // Tier 2: gated per policy
    "staff_reminder_email", // Tier 2: gated per policy
    "create_extension_draft",
    "status_memo",
    "plan_update",
  ]),
  defaultBudget: { ...DEFAULT_BUDGET, maxToolCalls: 120, maxWallClockMs: 30 * 60_000 },
};

/**
 * Release-prep agent — drives an approved review set end-to-end and PARKS at
 * "awaiting signature". publish_release / finalize_redactions are in the
 * allowlist so the agent may *reach* them, but the tier system turns them into a
 * human checkpoint (§16.3) — "one approval releases; nothing ships without it."
 */
const releasePrep: AgentDefinition = {
  type: "release_prep",
  title: "Release-prep agent",
  description:
    "Given an approved review set, applies redaction suggestions per profile, drafts the response letter, compiles the exemption log, assembles and checksums the packet, and parks it at 'awaiting signature'.",
  scope: "per_request",
  corpusScope: "full",
  allowedCapabilities: new Set<CapabilityName>([
    "read_request",
    "read_review_set",
    "read_documents",
    "suggest_redactions",
    "compile_exemption_log",
    "draft_message",
    "assemble_packet",
    "checksum_packet",
    "finalize_redactions", // Tier 3 → becomes a human checkpoint
    "publish_release", // Tier 3 → becomes a human checkpoint
    "status_memo",
    "plan_update",
  ]),
  defaultBudget: DEFAULT_BUDGET,
};

/**
 * Ingest steward (data-plane) — watches connector syncs and the review queue,
 * resolves classification ambiguity, flags anomalies, and *proposes* redaction
 * profiles and proactive-publication candidates. It never reclassifies
 * internal → public itself (that action is forbidden, §16.3).
 */
const ingestSteward: AgentDefinition = {
  type: "ingest_steward",
  title: "Ingest steward",
  description:
    "Watches connector syncs and the review queue: resolves classification ambiguity by cross-referencing similar prior items, flags anomalies, and proposes new redaction profiles and proactive-publication candidates.",
  scope: "data_plane",
  corpusScope: "full",
  allowedCapabilities: new Set<CapabilityName>([
    "read_sync_status",
    "read_review_queue",
    "read_documents",
    "corpus_search",
    "flag_for_review",
    "propose_redaction_profile",
    "propose_publication_candidate",
    "status_memo",
    "plan_update",
  ]),
  defaultBudget: { ...DEFAULT_BUDGET, maxToolCalls: 200 },
};

/**
 * Requester-side agent (portal) — the §6.7 answer engine extended to multi-turn
 * goal pursuit. Hard-scoped to the PUBLIC corpus (§16.3): corpusScope "public"
 * causes the orchestrator to pin every retrieval to classification='public', in
 * addition to the query-layer enforcement and the §13 hard-fail eval.
 */
const requesterSide: AgentDefinition = {
  type: "requester_side",
  title: "Requester-side agent",
  description:
    "Interviews the requester to pin down what they want, checks the public corpus at each narrowing step, and either fulfills from public records or drafts the tightest possible request on their behalf.",
  scope: "portal_session",
  corpusScope: "public",
  allowedCapabilities: new Set<CapabilityName>([
    "corpus_search", // public-only, enforced by the orchestrator
    "draft_message",
    "plan_update",
  ]),
  defaultBudget: { ...DEFAULT_BUDGET, maxToolCalls: 20, maxWallClockMs: 5 * 60_000 },
};

/**
 * Proactive-disclosure librarian (agentic-horizon B1, the first Phase-5
 * agent) — mines the request archive, deflection log, and archive misses for
 * repeated demand and proposes publication candidates. Tier-2 ceiling by
 * design, but its whole plan is Tier 1: it only ever PROPOSES — the
 * classification flip that makes anything public is a named human's act
 * (invariant 9 is the design).
 */
const disclosureLibrarian: AgentDefinition = {
  type: "disclosure_librarian",
  title: "Proactive-disclosure librarian",
  description:
    "Mines resolved requests, deflection-log queries, and archive misses for repeated demand patterns, and proposes proactive publications a named human can act on. Never publishes anything itself.",
  scope: "queue_wide",
  corpusScope: "full",
  allowedCapabilities: new Set<CapabilityName>([
    "read_demand_signals",
    "corpus_search",
    "propose_publication_candidate",
    "status_memo",
    "plan_update",
  ]),
  defaultBudget: { ...DEFAULT_BUDGET, maxToolCalls: 60, maxWallClockMs: 10 * 60_000 },
};

export const AGENT_DEFINITIONS: Record<AgentTypeName, AgentDefinition> = {
  fulfillment,
  deadline,
  release_prep: releasePrep,
  ingest_steward: ingestSteward,
  requester_side: requesterSide,
  disclosure_librarian: disclosureLibrarian,
};

export function getAgentDefinition(type: AgentTypeName): AgentDefinition {
  return AGENT_DEFINITIONS[type];
}
