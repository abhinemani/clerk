/**
 * Tests for the action-tier guardrails (spec §16.3). These assert the hard
 * safety invariants that make autonomy acceptable to a government buyer.
 */
import { describe, expect, it } from "vitest";
import {
  ACTION_TIERS,
  ALL_ACTIONS,
  assertPolicyValid,
  canAutoExecute,
  FORBIDDEN_ACTIONS,
  invalidPolicyEntries,
  isActionType,
  resolveDisposition,
  tierOf,
  type ActionType,
} from "./actionTiers";

describe("tier classification is total and consistent", () => {
  it("every action is either forbidden or has exactly one tier", () => {
    for (const action of ALL_ACTIONS) {
      const forbidden = FORBIDDEN_ACTIONS.has(action);
      const tiered = action in ACTION_TIERS;
      // Exactly one of the two must hold.
      expect(forbidden).toBe(!tiered);
    }
  });

  it("tierOf returns null for forbidden actions and 1|2|3 otherwise", () => {
    expect(tierOf("modify_audit_log")).toBeNull();
    for (const [action, tier] of Object.entries(ACTION_TIERS)) {
      expect(tierOf(action as ActionType)).toBe(tier);
      expect([1, 2, 3]).toContain(tier);
    }
  });

  it("isActionType recognizes known actions and rejects others", () => {
    expect(isActionType("publish_release")).toBe(true);
    expect(isActionType("read_queue")).toBe(false);
    expect(isActionType("nonsense")).toBe(false);
  });
});

describe("Tier 1 — autonomous", () => {
  it("resolves internal reversible actions as autonomous with no policy", () => {
    const r = resolveDisposition("corpus_search");
    expect(r.tier).toBe(1);
    expect(r.disposition).toBe("autonomous");
    expect(canAutoExecute("status_memo")).toBe(true);
  });
});

describe("Tier 2 — policy-gated, default off", () => {
  it("requires a human by default", () => {
    expect(resolveDisposition("send_acknowledgment").disposition).toBe("requires_human");
    expect(canAutoExecute("staff_reminder_email")).toBe(false);
  });

  it("becomes autonomous only when explicitly opted in", () => {
    const policy = { autoSendTier2: ["send_acknowledgment"] as ActionType[] };
    expect(resolveDisposition("send_acknowledgment", policy).disposition).toBe("autonomous");
    // A different Tier-2 action not in the list stays gated.
    expect(resolveDisposition("staff_reminder_email", policy).disposition).toBe("requires_human");
  });
});

describe("Tier 3 — always human, cannot be escalated (§16.3 core invariant)", () => {
  const tier3: ActionType[] = [
    "publish_release",
    "send_denial",
    "send_extension_notice",
    "send_fee_estimate",
    "finalize_redactions",
    "send_requester_message",
  ];

  it("every Tier-3 action requires a human with the default policy", () => {
    for (const a of tier3) {
      expect(resolveDisposition(a).disposition).toBe("requires_human");
    }
  });

  it("NO policy can move a Tier-3 action to autonomous — even if listed", () => {
    // Adversarial policy that (invalidly) tries to auto-send Tier-3 actions.
    const evil = { autoSendTier2: tier3 };
    for (const a of tier3) {
      expect(resolveDisposition(a, evil).disposition).toBe("requires_human");
      expect(canAutoExecute(a, evil)).toBe(false);
    }
  });
});

describe("Forbidden — never, under any configuration", () => {
  const forbidden: ActionType[] = [
    "modify_audit_log",
    "modify_statute_config",
    "reclassify_internal_to_public",
  ];

  it("resolves as forbidden regardless of policy", () => {
    const evil = { autoSendTier2: forbidden };
    for (const a of forbidden) {
      expect(resolveDisposition(a).disposition).toBe("forbidden");
      expect(resolveDisposition(a, evil).disposition).toBe("forbidden");
      expect(canAutoExecute(a, evil)).toBe(false);
    }
  });
});

describe("policy validation", () => {
  it("flags non-Tier-2 entries in the auto-send list", () => {
    const bad = { autoSendTier2: ["publish_release", "corpus_search"] as ActionType[] };
    expect(invalidPolicyEntries(bad).sort()).toEqual(["corpus_search", "publish_release"]);
    expect(() => assertPolicyValid(bad)).toThrow(/only Tier-2 actions/);
  });

  it("accepts a valid Tier-2-only policy", () => {
    const ok = { autoSendTier2: ["send_acknowledgment", "dispatch_task"] as ActionType[] };
    expect(invalidPolicyEntries(ok)).toEqual([]);
    expect(() => assertPolicyValid(ok)).not.toThrow();
  });
});
