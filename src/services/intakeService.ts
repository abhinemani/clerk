/**
 * Shared intake chain — ONE filing path for every front door (portal form,
 * requester API, MCP file_request). `submitRequest` is the legal act; the
 * follow-ups here are advisory and each fails soft: deterministic routing
 * rules first (explicit agency policy outranks everything), then learned
 * play routing (docs/learning-loop.md), then the intake-triage job (AI
 * proposes off the request path), then duplicate detection on stored ask
 * vectors. Extracted from the portal server action so a second entry point
 * could never fork the chain.
 */
import type { ServiceDeps } from "./deps";
import type { RequestEntity } from "./repository";
import { submitRequest, type SubmitRequestInput } from "./requestService";

type EnqueueTriage = (kind: "intake_triage", payload: { agencyId: string; requestId: string }) => void;

export async function submitAndDispatch(
  deps: ServiceDeps,
  input: SubmitRequestInput,
  /** Test seam (same idiom as emitStatusWebhook): the durable queue otherwise. */
  enqueueOverride?: EnqueueTriage,
): Promise<RequestEntity> {
  const request = await submitRequest(deps, input);
  const { agencyId } = input;
  const rawText = input.rawText;

  // Deterministic routing rules (explicit agency policy, no model): matches
  // become proposal cards, and — with auto-dispatch on — department tasks go
  // out before the requester leaves. Advisory failure only.
  try {
    const { applyAgencyRoutingRules } = await import("@/services/taskService");
    await applyAgencyRoutingRules(deps, { agencyId, requestId: request.id, rawText });
  } catch (e) {
    console.error("routing rules failed", e);
  }

  // Learned routing second: precedent stats as a card, earned-confidence
  // route through the same auto-dispatch gate (whose tasks-already-exist
  // guard keeps this advisory when a rule fired). Deterministic, no model.
  try {
    const { applyPlayRouting } = await import("@/services/learningService");
    await applyPlayRouting(deps, { agencyId, requestId: request.id, rawText });
  } catch (e) {
    console.error("play routing failed", e);
  }

  // AI proposes off the request path: queue intake triage (§6.1). The job
  // no-ops without ANTHROPIC_API_KEY. Advisory — the filing already stands.
  try {
    if (enqueueOverride) {
      enqueueOverride("intake_triage", { agencyId, requestId: request.id });
    } else {
      const { getJobQueue } = await import("@/jobs/queue");
      getJobQueue().enqueue("intake_triage", { agencyId, requestId: request.id });
    }
  } catch (e) {
    console.error("intake triage enqueue failed", e);
  }

  // Duplicate & related detection (§6.2) on STORED ask vectors — the
  // request's own vector was written moments ago in submitRequest, so the
  // common case costs zero embed calls; vector-less rows degrade to token
  // overlap inside the service. Advisory only.
  try {
    const { findDuplicateRequests } = await import("@/services/similarRequestsService");
    const matches = await findDuplicateRequests(deps, {
      agencyId,
      requestId: request.id,
      text: rawText,
      limit: 3,
    });
    if (matches.length > 0) {
      await deps.repo.appendEvent({
        id: deps.genId(),
        agencyId,
        requestId: request.id,
        kind: "ai_action",
        actorUserId: null,
        summary: `Possible duplicate of ${matches.map((m) => m.publicId).join(", ")}`,
        payload: {
          pipeline: "duplicate_check",
          matches: matches.map((m) => ({
            requestId: m.id,
            publicId: m.publicId,
            similarity: Math.round(m.similarity * 100) / 100,
            status: m.status,
          })),
        },
        createdAt: deps.now(),
      });
    }
  } catch (e) {
    console.error("duplicate check failed", e);
  }

  return request;
}
