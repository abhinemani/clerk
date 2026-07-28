/**
 * Release-prep agent (spec §16.1) — drives an approved review set end-to-end and
 * PARKS at "awaiting signature."
 *
 *   read_review_set → suggest_redactions (per profile) → compile_exemption_log
 *   → draft response letter → assemble_packet → checksum_packet
 *   → publish_release  ← Tier-3, so the harness stops here for a human
 *
 * Everything up to release is autonomous; publish_release is Tier 3, so the run
 * parks at a human checkpoint — "one approval releases; nothing ships without it"
 * (§16.3). Runs model-free (the cover letter is templated; the real §6.6 letter
 * pipeline can replace it).
 */
import type { AgentPlanStep } from "@/db/schema";
import { seededSuggestions, type Suggestion } from "@/ai/redaction/profiles";
import { DEFAULT_ACTION_POLICY, type AgencyActionPolicy } from "./actionTiers";
import { DEFAULT_BUDGET, ZERO_SPEND } from "./budget";
import { getAgentDefinition } from "./definitions";
import { runAgent, type AgentActionEvent, type AgentRunState } from "./runHarness";
import { MapCapabilityRegistry, type Capability } from "./tools";

export interface ReviewDoc {
  id: string;
  filename: string;
  recordType?: string;
  lines: string[];
}

export interface ReleasePrepInput {
  request: { publicId: string };
  reviewSet: ReviewDoc[];
}

export interface ExemptionLogEntry {
  exemption: string;
  count: number;
  documents: string[];
}

export interface ReleasePrepResult {
  redactions: number;
  exemptionLog: ExemptionLogEntry[];
  letter: string;
  checksum: string;
  /** "awaiting_checkpoint" — parked for a human to sign off before release. */
  outcome: string;
  parkedAt: string | null;
  events: AgentActionEvent[];
}

function step(index: number, action: string): AgentPlanStep {
  return { index, description: action, status: "pending", action, input: {} };
}
function cap(name: string, fn: () => unknown): Capability {
  return { name: name as never, async execute() { return { output: fn(), tokens: 0 }; } };
}

function hashHex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, "0");
}

export async function runReleasePrep(
  input: ReleasePrepInput,
  deps: { agencyId?: string; policy?: AgencyActionPolicy } = {},
): Promise<ReleasePrepResult> {
  const scratch: {
    redactions: Array<Suggestion & { docId: string }>;
    exemptionLog: ExemptionLogEntry[];
    letter: string;
    checksum: string;
  } = { redactions: [], exemptionLog: [], letter: "", checksum: "" };

  const registry = new MapCapabilityRegistry([
    cap("read_review_set", () => ({ documents: input.reviewSet.map((d) => d.id) })),
    cap("suggest_redactions", () => {
      for (const doc of input.reviewSet) {
        for (const s of seededSuggestions(doc.recordType, doc.lines)) {
          scratch.redactions.push({ ...s, docId: doc.id });
        }
      }
      return { count: scratch.redactions.length };
    }),
    cap("compile_exemption_log", () => {
      const byExemption = new Map<string, Set<string>>();
      for (const r of scratch.redactions) {
        const set = byExemption.get(r.reason) ?? new Set<string>();
        set.add(r.docId);
        byExemption.set(r.reason, set);
      }
      scratch.exemptionLog = [...byExemption.entries()]
        .map(([exemption, docs]) => ({
          exemption,
          count: scratch.redactions.filter((r) => r.reason === exemption).length,
          documents: [...docs],
        }))
        .sort((a, b) => b.count - a.count);
      return { entries: scratch.exemptionLog.length };
    }),
    cap("draft_message", () => {
      const exLines = scratch.exemptionLog.map((e) => `  - ${e.exemption} (${e.count})`).join("\n");
      scratch.letter = [
        `Re: Public Records Request ${input.request.publicId}`,
        ``,
        `We are releasing ${input.reviewSet.length} responsive record(s). Portions have been`,
        `withheld or redacted under the following exemptions:`,
        exLines || "  (no redactions)",
        ``,
        `An itemized exemption log accompanies this release.`,
      ].join("\n");
      return { drafted: true };
    }),
    cap("assemble_packet", () => ({ artifacts: input.reviewSet.map((d) => d.filename) })),
    cap("checksum_packet", () => {
      scratch.checksum = hashHex(
        JSON.stringify({ docs: input.reviewSet.map((d) => d.id), letter: scratch.letter, log: scratch.exemptionLog }),
      );
      return { checksum: scratch.checksum };
    }),
  ]);

  const steps: AgentPlanStep[] = [
    step(0, "read_review_set"),
    step(1, "suggest_redactions"),
    step(2, "compile_exemption_log"),
    step(3, "draft_message"),
    step(4, "assemble_packet"),
    step(5, "checksum_packet"),
    step(6, "publish_release"), // Tier 3 → the harness parks here for a human
  ];

  const run: AgentRunState = {
    id: `release-prep-${input.request.publicId}`,
    agencyId: deps.agencyId ?? "agency",
    requestId: input.request.publicId,
    status: "planning",
    plan: { goal: `Prepare release for ${input.request.publicId}`, cursor: 0, steps },
    budgetLimits: { ...DEFAULT_BUDGET },
    budgetSpend: { ...ZERO_SPEND },
  };

  const events: AgentActionEvent[] = [];
  const res = await runAgent(run, {
    definition: getAgentDefinition("release_prep"),
    policy: deps.policy ?? DEFAULT_ACTION_POLICY,
    registry,
    emit: (e) => void events.push(e),
  });

  return {
    redactions: scratch.redactions.length,
    exemptionLog: scratch.exemptionLog,
    letter: scratch.letter,
    checksum: scratch.checksum,
    outcome: res.outcome,
    parkedAt: res.outcome === "awaiting_checkpoint" ? "publish_release" : null,
    events,
  };
}
