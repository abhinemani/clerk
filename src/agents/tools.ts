/**
 * The agent capability surface (spec §16.2).
 *
 * "Agents are orchestrations over existing pipelines and tools, not new
 *  capabilities. Tool surface per agent is an explicit allowlist."
 *
 * A capability is either:
 *   - a read tool (ReadToolName): pure retrieval/compute, no side effects, always
 *     autonomous; or
 *   - an action (ActionType from actionTiers): a side-effecting move subject to
 *     the tier system.
 *
 * Concrete implementations of these capabilities are the §6 pipelines and the
 * §9 data-plane connectors — which Phases 2–4 build. Here we define only the
 * interface and an injectable registry, so the agent framework can be built and
 * tested now against fakes, and wired to real pipelines later without change.
 */
import type { ActionType } from "./actionTiers";
import { isActionType } from "./actionTiers";

/** Read-only tools: retrieval and inspection, no side effects. */
export type ReadToolName =
  | "read_queue"
  | "read_request"
  | "read_events"
  | "read_documents"
  | "read_task_status"
  | "read_review_set"
  | "read_sync_status"
  | "read_review_queue"
  | "compute_deadline_risk";

/** Anything an agent step can invoke. */
export type CapabilityName = ReadToolName | ActionType;

export interface CapabilityContext {
  agencyId: string;
  agentRunId: string;
  requestId?: string;
  /**
   * Retrieval scope for corpus/connector reads. For requester-side agents this
   * is hard-pinned to "public" by the orchestrator (§16.3) — the capability
   * implementation must honor it (and the query layer enforces it independently).
   */
  corpusScope?: "public" | "full";
}

export interface CapabilityResult {
  output: unknown;
  /** Tokens consumed by this call, folded into the run budget (§16.2). */
  tokens?: number;
}

export interface Capability {
  name: CapabilityName;
  execute(input: Record<string, unknown>, ctx: CapabilityContext): Promise<CapabilityResult>;
}

export interface CapabilityRegistry {
  get(name: CapabilityName): Capability | undefined;
  has(name: CapabilityName): boolean;
}

const READ_TOOLS = new Set<ReadToolName>([
  "read_queue",
  "read_request",
  "read_events",
  "read_documents",
  "read_task_status",
  "read_review_set",
  "read_sync_status",
  "read_review_queue",
  "compute_deadline_risk",
]);

export function isReadTool(name: string): name is ReadToolName {
  return READ_TOOLS.has(name as ReadToolName);
}

export function isKnownCapability(name: string): name is CapabilityName {
  return isReadTool(name) || isActionType(name);
}

/** A simple in-memory registry — used for tests and to wire real pipelines. */
export class MapCapabilityRegistry implements CapabilityRegistry {
  private readonly map = new Map<CapabilityName, Capability>();

  constructor(capabilities: Capability[] = []) {
    for (const c of capabilities) this.map.set(c.name, c);
  }

  register(capability: Capability): this {
    this.map.set(capability.name, capability);
    return this;
  }

  get(name: CapabilityName): Capability | undefined {
    return this.map.get(name);
  }

  has(name: CapabilityName): boolean {
    return this.map.has(name);
  }
}
