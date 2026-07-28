/**
 * Action tiers — the agentic guardrail layer (spec §16.3).
 *
 * "Guardrails (tighter than draft-and-approve, because autonomy compounds risk)."
 *
 * Every side-effecting move an agent can make is classified into a tier:
 *   Tier 1 — autonomous: internal-only, reversible (search, draft, internal nudge).
 *   Tier 2 — policy-gated: external but low-stakes; an agency may opt into
 *            auto-sending. Default OFF.
 *   Tier 3 — always human: legally significant / requester-facing with substance.
 *            NO configuration can move these to Tier 2. Enforced here, in code.
 *
 * On top of the tiers there is a FORBIDDEN set: actions an agent may never take
 * under any tier or configuration — modifying the audit log, statute config, or
 * reclassifying internal → public (§16.3 hard rules).
 *
 * This module is pure and has no I/O so it can be exhaustively unit-tested — it
 * is the agentic equivalent of computeDueDate(): the load-bearing safety logic.
 */

export type Tier = 1 | 2 | 3;

/** The disposition of an attempted action given an agency's policy. */
export type Disposition = "autonomous" | "requires_human" | "forbidden";

/**
 * Every action an agent can attempt. Adding an action here without also placing
 * it in ACTION_TIERS or FORBIDDEN_ACTIONS is a compile-time-adjacent error that
 * the test suite asserts against (see actionTiers.test.ts).
 */
export type ActionType =
  // ---- Tier 1: autonomous, internal-only, reversible ----
  | "corpus_search"
  | "connector_search"
  | "draft_message"
  | "internal_nudge" // in-app nudge to an internal custodian/coordinator
  | "status_memo"
  | "plan_update"
  | "assemble_review_set"
  | "suggest_redactions"
  | "propose_task" // draft a task; dispatching it externally is Tier 2
  | "create_extension_draft" // draft only; sending the notice is Tier 3
  | "compile_exemption_log"
  | "assemble_packet"
  | "checksum_packet"
  | "propose_redaction_profile"
  | "propose_publication_candidate"
  | "flag_for_review" // ingest steward holding an anomalous item
  // ---- Tier 2: policy-gated external, low-stakes (default off) ----
  | "send_acknowledgment"
  | "staff_reminder_email"
  | "dispatch_task" // email a responder their task link
  | "send_custodian_nudge_email"
  // ---- Tier 3: always human, legally significant / requester-facing ----
  | "publish_release"
  | "send_denial"
  | "send_extension_notice"
  | "finalize_redactions"
  | "send_requester_message" // substantive requester-facing correspondence
  // ---- Forbidden: never, under any config ----
  | "modify_audit_log"
  | "modify_statute_config"
  | "reclassify_internal_to_public";

export const FORBIDDEN_ACTIONS = new Set<ActionType>([
  "modify_audit_log",
  "modify_statute_config",
  "reclassify_internal_to_public",
]);

/** Every known action name — used by the harness to tell actions from read-tools. */
export const ALL_ACTIONS = new Set<ActionType>([
  "corpus_search",
  "connector_search",
  "draft_message",
  "internal_nudge",
  "status_memo",
  "plan_update",
  "assemble_review_set",
  "suggest_redactions",
  "propose_task",
  "create_extension_draft",
  "compile_exemption_log",
  "assemble_packet",
  "checksum_packet",
  "propose_redaction_profile",
  "propose_publication_candidate",
  "flag_for_review",
  "send_acknowledgment",
  "staff_reminder_email",
  "dispatch_task",
  "send_custodian_nudge_email",
  "publish_release",
  "send_denial",
  "send_extension_notice",
  "finalize_redactions",
  "send_requester_message",
  "modify_audit_log",
  "modify_statute_config",
  "reclassify_internal_to_public",
]);

export function isActionType(name: string): name is ActionType {
  return ALL_ACTIONS.has(name as ActionType);
}

/**
 * The tier of every non-forbidden action. This is the single source of truth.
 * Tier 3 membership here is immutable at runtime — see resolveDisposition.
 */
export const ACTION_TIERS: Record<Exclude<ActionType, "modify_audit_log" | "modify_statute_config" | "reclassify_internal_to_public">, Tier> = {
  // Tier 1
  corpus_search: 1,
  connector_search: 1,
  draft_message: 1,
  internal_nudge: 1,
  status_memo: 1,
  plan_update: 1,
  assemble_review_set: 1,
  suggest_redactions: 1,
  propose_task: 1,
  create_extension_draft: 1,
  compile_exemption_log: 1,
  assemble_packet: 1,
  checksum_packet: 1,
  propose_redaction_profile: 1,
  propose_publication_candidate: 1,
  flag_for_review: 1,
  // Tier 2
  send_acknowledgment: 2,
  staff_reminder_email: 2,
  dispatch_task: 2,
  send_custodian_nudge_email: 2,
  // Tier 3
  publish_release: 3,
  send_denial: 3,
  send_extension_notice: 3,
  finalize_redactions: 3,
  send_requester_message: 3,
};

/** Per-agency guardrail configuration (§16.3). */
export interface AgencyActionPolicy {
  /**
   * Tier-2 actions this agency has opted into auto-sending. Only Tier-2 actions
   * have any effect here; listing a Tier-3 or forbidden action is ignored (and
   * flagged by assertPolicyValid / the test suite). Default: empty (all off).
   */
  autoSendTier2: readonly ActionType[];
}

export const DEFAULT_ACTION_POLICY: AgencyActionPolicy = { autoSendTier2: [] };

/** The tier of an action, or null if it is forbidden (has no tier). */
export function tierOf(action: ActionType): Tier | null {
  if (FORBIDDEN_ACTIONS.has(action)) return null;
  return ACTION_TIERS[action as keyof typeof ACTION_TIERS];
}

export interface ResolvedAction {
  action: ActionType;
  tier: Tier | null;
  disposition: Disposition;
  /** Human-readable reason, for the audit log and the "why" question (§16.2). */
  reason: string;
}

/**
 * Resolve what happens when an agent attempts `action` under `policy`.
 *
 * Hard invariants enforced here regardless of input:
 *  - Forbidden actions are always `forbidden`.
 *  - Tier 3 actions are always `requires_human` — configuration cannot change it.
 *  - Tier 2 actions are `autonomous` only if explicitly opted in, else human.
 *  - Tier 1 actions are always `autonomous`.
 */
export function resolveDisposition(
  action: ActionType,
  policy: AgencyActionPolicy = DEFAULT_ACTION_POLICY,
): ResolvedAction {
  if (FORBIDDEN_ACTIONS.has(action)) {
    return {
      action,
      tier: null,
      disposition: "forbidden",
      reason: `"${action}" is a forbidden action — agents may never perform it (§16.3).`,
    };
  }

  const tier = ACTION_TIERS[action as keyof typeof ACTION_TIERS];

  if (tier === 3) {
    return {
      action,
      tier,
      disposition: "requires_human",
      reason: `"${action}" is Tier 3 (legally significant / requester-facing); always requires human approval — no configuration can autonomize it (§16.3).`,
    };
  }

  if (tier === 2) {
    // Only a Tier-2 action can be autonomized, and only if opted in. We re-check
    // the opted-in action's real tier so a mis-configured Tier-3 entry can never
    // slip through even if it appears in the policy list.
    const optedIn =
      policy.autoSendTier2.includes(action) && ACTION_TIERS[action as keyof typeof ACTION_TIERS] === 2;
    return {
      action,
      tier,
      disposition: optedIn ? "autonomous" : "requires_human",
      reason: optedIn
        ? `"${action}" is Tier 2 and this agency has opted into auto-sending it.`
        : `"${action}" is Tier 2 and not opted in; requires human approval (default off).`,
    };
  }

  // Tier 1
  return {
    action,
    tier,
    disposition: "autonomous",
    reason: `"${action}" is Tier 1 (internal, reversible); autonomous.`,
  };
}

/** True iff the agent may perform `action` without a human, under `policy`. */
export function canAutoExecute(
  action: ActionType,
  policy: AgencyActionPolicy = DEFAULT_ACTION_POLICY,
): boolean {
  return resolveDisposition(action, policy).disposition === "autonomous";
}

/**
 * Validate an agency policy: any entry in `autoSendTier2` that is not actually a
 * Tier-2 action is invalid. Returns the offending entries (empty = valid). Use
 * this at config-write time so a Tier-3 escalation attempt is rejected loudly
 * rather than silently ignored.
 */
export function invalidPolicyEntries(policy: AgencyActionPolicy): ActionType[] {
  return policy.autoSendTier2.filter((a) => tierOf(a) !== 2);
}

/** Throw if any Tier-3 or forbidden action is present in the auto-send list. */
export function assertPolicyValid(policy: AgencyActionPolicy): void {
  const bad = invalidPolicyEntries(policy);
  if (bad.length > 0) {
    throw new Error(
      `Invalid action policy: only Tier-2 actions may be auto-sent; offending entries: ${bad.join(", ")}`,
    );
  }
}
