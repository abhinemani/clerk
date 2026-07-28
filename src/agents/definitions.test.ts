/** Tests for the agent definitions / tool allowlists (spec §16.1, §16.2). */
import { describe, expect, it } from "vitest";
import { AGENT_DEFINITIONS, getAgentDefinition } from "./definitions";
import { isKnownCapability } from "./tools";
import { FORBIDDEN_ACTIONS } from "./actionTiers";

describe("agent definitions", () => {
  it("defines all five agents (§16.1)", () => {
    expect(Object.keys(AGENT_DEFINITIONS).sort()).toEqual([
      "deadline",
      "fulfillment",
      "ingest_steward",
      "release_prep",
      "requester_side",
    ]);
  });

  it("every allowlisted capability is a known read-tool or action", () => {
    for (const def of Object.values(AGENT_DEFINITIONS)) {
      for (const cap of def.allowedCapabilities) {
        expect(isKnownCapability(cap), `${def.type}: ${cap}`).toBe(true);
      }
    }
  });

  it("no agent may ever allowlist a forbidden action (§16.3)", () => {
    for (const def of Object.values(AGENT_DEFINITIONS)) {
      for (const cap of def.allowedCapabilities) {
        expect(FORBIDDEN_ACTIONS.has(cap as never)).toBe(false);
      }
    }
  });

  it("every agent has positive budget caps", () => {
    for (const def of Object.values(AGENT_DEFINITIONS)) {
      expect(def.defaultBudget.maxToolCalls).toBeGreaterThan(0);
      expect(def.defaultBudget.maxTokens).toBeGreaterThan(0);
      expect(def.defaultBudget.maxWallClockMs).toBeGreaterThan(0);
    }
  });

  it("requester-side agent is hard-scoped to the public corpus (§16.3)", () => {
    expect(getAgentDefinition("requester_side").corpusScope).toBe("public");
    // ...and cannot even reach agency-side sends.
    const caps = getAgentDefinition("requester_side").allowedCapabilities;
    expect(caps.has("publish_release")).toBe(false);
    expect(caps.has("send_requester_message")).toBe(false);
  });

  it("staff-side agents use the full corpus", () => {
    for (const t of ["fulfillment", "deadline", "release_prep", "ingest_steward"] as const) {
      expect(getAgentDefinition(t).corpusScope).toBe("full");
    }
  });

  it("deadline agent stays near its spec allowlist ('nothing else')", () => {
    const caps = getAgentDefinition("deadline").allowedCapabilities;
    // The spec's explicit examples must be present...
    for (const c of ["read_queue", "draft_message", "internal_nudge", "create_extension_draft"] as const) {
      expect(caps.has(c)).toBe(true);
    }
    // ...and it must NOT be able to release or redact.
    expect(caps.has("publish_release")).toBe(false);
    expect(caps.has("finalize_redactions")).toBe(false);
  });

  it("release-prep can reach the release gate (so it becomes a checkpoint)", () => {
    const caps = getAgentDefinition("release_prep").allowedCapabilities;
    expect(caps.has("publish_release")).toBe(true);
    expect(caps.has("finalize_redactions")).toBe(true);
  });
});
