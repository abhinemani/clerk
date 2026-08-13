/**
 * Appeal-defense packet builder (agentic-horizon B3) — the audit log's
 * reader. Per-request, on demand (or on denial): assemble the dossier
 * counsel needs — timeline, deadline bases (invariant 7), exemption
 * citations with deciders, every letter, checksummed releases — plus a
 * composed cover-memo DRAFT.
 *
 * Every step is Tier 1: compiling and drafting are internal and reversible.
 * The spec's "one Tier-2 send" (emailing the packet to counsel) is not
 * wired yet — the packet downloads from the request page instead, so
 * nothing leaves the building without a human doing it.
 *
 * Deterministic (template memo, no model), through the real run harness:
 * allowlist → tier → budget, one append-only audit event per step.
 */
import { createHash } from "node:crypto";
import type { AgentPlanStep } from "@/db/schema";
import {
  buildAppealPacket,
  renderAppealPacketText,
  type AppealPacket,
  type AppealPacketInput,
} from "@/reporting/appealPacket";
import { DEFAULT_ACTION_POLICY, type AgencyActionPolicy } from "./actionTiers";
import { DEFAULT_BUDGET, ZERO_SPEND } from "./budget";
import { getAgentDefinition } from "./definitions";
import { runAgent, type AgentActionEvent, type AgentRunState } from "./runHarness";
import { MapCapabilityRegistry, type Capability } from "./tools";

export interface AppealPacketResult {
  packet: AppealPacket;
  /** The exportable plain-text body (the PDF route wraps it). */
  text: string;
  /** sha-256 of the rendered text — printed on the packet, provable later. */
  checksum: string;
  outcome: string;
  events: AgentActionEvent[];
}

function step(index: number, action: string, input: Record<string, unknown> = {}): AgentPlanStep {
  return { index, description: action, status: "pending", action, input };
}

function cap(name: string, fn: (input: Record<string, unknown>) => unknown): Capability {
  return {
    name: name as never,
    async execute(input) {
      return { output: fn(input), tokens: 0 };
    },
  };
}

/** Assemble the packet as a real agent execution. */
export async function runAppealPacketAssembly(
  input: AppealPacketInput & { policy?: AgencyActionPolicy; agencyId: string },
): Promise<AppealPacketResult> {
  const packet = buildAppealPacket(input);
  const text = renderAppealPacketText(packet);
  const checksum = createHash("sha256").update(text).digest("hex");

  const registry = new MapCapabilityRegistry([
    cap("read_request", () => ({ publicId: input.request.publicId, status: input.request.status })),
    cap("read_events", () => ({ events: input.events.length })),
    cap("compile_exemption_log", () => ({ decisions: packet.exemptions.length })),
    cap("draft_message", () => ({ coverMemoLines: packet.coverMemo.length, draft: true })),
    cap("assemble_packet", () => ({
      sections: 5,
      correspondence: packet.correspondence.length,
      releases: packet.releases.length,
    })),
    cap("checksum_packet", () => ({ sha256: checksum })),
    cap("status_memo", () => ({ memo: `Appeal packet assembled for ${input.request.publicId}` })),
  ]);

  let idx = 0;
  const steps: AgentPlanStep[] = [
    step(idx++, "read_request"),
    step(idx++, "read_events"),
    step(idx++, "compile_exemption_log"),
    step(idx++, "draft_message", { kind: "cover_memo" }),
    step(idx++, "assemble_packet"),
    step(idx++, "checksum_packet"),
    step(idx++, "status_memo"),
  ];

  const run: AgentRunState = {
    id: `appeal-packet-${input.request.publicId}`,
    agencyId: input.agencyId,
    requestId: input.request.id,
    status: "planning",
    plan: { goal: `Assemble appeal-defense packet for ${input.request.publicId}`, cursor: 0, steps },
    budgetLimits: { ...DEFAULT_BUDGET },
    budgetSpend: { ...ZERO_SPEND },
  };

  const events: AgentActionEvent[] = [];
  const res = await runAgent(run, {
    definition: getAgentDefinition("appeal_packet"),
    policy: input.policy ?? DEFAULT_ACTION_POLICY,
    registry,
    emit: (e) => void events.push(e),
  });

  return { packet, text, checksum, outcome: res.outcome, events };
}
