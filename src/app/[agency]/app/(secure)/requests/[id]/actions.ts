"use server";

/**
 * Coordinator workspace actions — the moves that used to be client-side
 * theater are now real: every one goes through the service layer, appends to
 * the append-only audit log, and revalidates the page. The staff session is
 * re-derived server-side on each call.
 */
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { defaultDeps } from "@/services/deps";
import { MessageError, sendStaffMessage } from "@/services/messageService";
import { denyRequest, ReleaseError, releaseRequest, reviewDocument } from "@/services/releaseService";
import { approveTriage, ExtensionError, extendRequest, transitionRequest } from "@/services/requestService";
import type { ReviewDecision } from "@/services/repository";
import {
  acceptTaskRecords,
  dispatchTask,
  reassignTask,
  returnTaskToResponder,
} from "@/services/taskService";

export type WorkspaceResult = { ok: true } | { ok: false; error: string };

const MS_DAY = 86_400_000;

async function ctx(agencySlug: string) {
  const staff = await requireStaff(agencySlug);
  const repo = await getRepository();
  const deps = { ...defaultDeps(repo), agencyName: undefined as string | undefined };
  const agency = await repo.getAgency(staff.agencyId);
  deps.agencyName = agency?.name;
  return { staff, repo, deps };
}

function fail(op: string, e: unknown): WorkspaceResult {
  console.error(`${op} failed`, e);
  const message = e instanceof Error ? e.message : "Something went wrong.";
  return { ok: false, error: message };
}

export async function acceptTriageAction(input: {
  agencySlug: string;
  requestId: string;
  interpretedScope: string;
  recordTypes: string[];
}): Promise<WorkspaceResult> {
  try {
    const { staff, deps } = await ctx(input.agencySlug);
    await approveTriage(deps, {
      agencyId: staff.agencyId,
      requestId: input.requestId,
      actorUserId: staff.userId,
      interpretedScope: input.interpretedScope,
      recordTypes: input.recordTypes,
    });
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    return { ok: true };
  } catch (e) {
    return fail("acceptTriage", e);
  }
}

export async function dismissTriageAction(input: {
  agencySlug: string;
  requestId: string;
}): Promise<WorkspaceResult> {
  try {
    const { staff, deps } = await ctx(input.agencySlug);
    await deps.repo.appendEvent({
      id: deps.genId(),
      agencyId: staff.agencyId,
      requestId: input.requestId,
      kind: "note",
      actorUserId: staff.userId,
      summary: "Coordinator dismissed the triage draft",
      createdAt: deps.now(),
    });
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    return { ok: true };
  } catch (e) {
    return fail("dismissTriage", e);
  }
}

export async function dispatchTaskAction(input: {
  agencySlug: string;
  requestId: string;
  departmentId: string;
  scopeText: string;
}): Promise<WorkspaceResult> {
  try {
    const { staff, repo, deps } = await ctx(input.agencySlug);
    const departments = await repo.listDepartments(staff.agencyId);
    const dept = departments.find((d) => d.id === input.departmentId);
    if (!dept) return { ok: false, error: "Unknown department." };

    // Move a fresh request forward when its first task goes out.
    const request = await repo.getRequest(staff.agencyId, input.requestId);
    if (request?.status === "submitted") {
      await transitionRequest(deps, {
        agencyId: staff.agencyId,
        requestId: input.requestId,
        to: "in_review",
        actorUserId: staff.userId,
        note: "First dispatch",
      });
    }
    if (request?.status === "submitted" || request?.status === "in_review") {
      await transitionRequest(deps, {
        agencyId: staff.agencyId,
        requestId: input.requestId,
        to: "in_progress",
        actorUserId: staff.userId,
        note: "Departments working",
      });
    }

    await dispatchTask(deps, {
      agencyId: staff.agencyId,
      requestId: input.requestId,
      departmentId: dept.id,
      departmentName: dept.name,
      departmentEmail: dept.defaultResponderEmails[0],
      departmentLead: dept.name,
      scopeText: input.scopeText,
      dueAt: new Date(Date.now() + 3 * MS_DAY), // internal SLA, ahead of statute
      actorUserId: staff.userId,
    });
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    return { ok: true };
  } catch (e) {
    return fail("dispatchTask", e);
  }
}

export async function acceptRecordsAction(input: {
  agencySlug: string;
  requestId: string;
  taskId: string;
}): Promise<WorkspaceResult> {
  try {
    const { staff, deps } = await ctx(input.agencySlug);
    await acceptTaskRecords(deps, {
      agencyId: staff.agencyId,
      taskId: input.taskId,
      actorUserId: staff.userId,
    });
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    return { ok: true };
  } catch (e) {
    return fail("acceptRecords", e);
  }
}

export async function sendBackAction(input: {
  agencySlug: string;
  requestId: string;
  taskId: string;
}): Promise<WorkspaceResult> {
  try {
    const { staff, deps } = await ctx(input.agencySlug);
    await returnTaskToResponder(deps, {
      agencyId: staff.agencyId,
      taskId: input.taskId,
      actorUserId: staff.userId,
    });
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    return { ok: true };
  } catch (e) {
    return fail("sendBack", e);
  }
}

export async function reviewDocumentAction(input: {
  agencySlug: string;
  requestId: string;
  documentId: string;
  decision: ReviewDecision;
  exemptionLabel?: string;
}): Promise<WorkspaceResult> {
  try {
    const { staff, deps } = await ctx(input.agencySlug);
    await reviewDocument(deps, {
      agencyId: staff.agencyId,
      requestId: input.requestId,
      documentId: input.documentId,
      decision: input.decision,
      exemptionLabel: input.exemptionLabel,
      actorUserId: staff.userId,
    });
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ReleaseError) return { ok: false, error: e.message };
    return fail("reviewDocument", e);
  }
}

export async function releaseRequestAction(input: {
  agencySlug: string;
  requestId: string;
  visibility: "public" | "private";
  responseLetter?: string;
  archiveTitle?: string;
  archiveSummary?: string;
  acceptResidualRisk?: boolean;
}): Promise<WorkspaceResult> {
  try {
    const { staff, deps } = await ctx(input.agencySlug);
    await releaseRequest(deps, {
      agencyId: staff.agencyId,
      requestId: input.requestId,
      actorUserId: staff.userId, // the named approver
      visibility: input.visibility,
      responseLetter: input.responseLetter,
      archiveTitle: input.archiveTitle,
      archiveSummary: input.archiveSummary,
      acceptResidualRisk: input.acceptResidualRisk,
    });
    if (input.visibility === "public") {
      // The archive grew — give the new entry a search vector (§6.7).
      const { getJobQueue } = await import("@/jobs/queue");
      getJobQueue().enqueue("embed_public_documents", { agencyId: staff.agencyId });
    }
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    revalidatePath(`/${input.agencySlug}/archive`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ReleaseError) return { ok: false, error: e.message };
    return fail("releaseRequest", e);
  }
}

export async function sendMessageAction(input: {
  agencySlug: string;
  requestId: string;
  subject?: string;
  body: string;
  internal?: boolean;
  requestClarification?: boolean;
  aiDrafted?: boolean;
  aiMeta?: { promptVersion: string; model: string };
}): Promise<WorkspaceResult> {
  try {
    const { staff, deps } = await ctx(input.agencySlug);
    await sendStaffMessage(deps, {
      agencyId: staff.agencyId,
      requestId: input.requestId,
      actorUserId: staff.userId, // the named human on every outbound (§10)
      subject: input.subject,
      body: input.body,
      internal: input.internal,
      requestClarification: input.requestClarification,
      aiDrafted: input.aiDrafted,
      aiMeta: input.aiMeta,
    });
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof MessageError) return { ok: false, error: e.message };
    return fail("sendMessage", e);
  }
}

export type DraftReplyResult =
  | {
      ok: true;
      subject: string;
      body: string;
      /** True when the §6.6 pipeline drafted it (vs. the offline template). */
      aiDrafted: boolean;
      aiMeta?: { promptVersion: string; model: string };
      warnings: string[];
    }
  | { ok: false; error: string };

/**
 * Draft a clarification letter (§6.6) for staff to edit and send — the
 * "AI proposes" half; sendMessageAction with the staff session is the dispose.
 * Without ANTHROPIC_API_KEY a plain template stands in so the flow still works.
 */
export async function draftReplyAction(input: {
  agencySlug: string;
  requestId: string;
}): Promise<DraftReplyResult> {
  try {
    const { staff, repo } = await ctx(input.agencySlug);
    const request = await repo.getRequest(staff.agencyId, input.requestId);
    if (!request) return { ok: false, error: "Request not found." };
    const [agency, requester, thread] = await Promise.all([
      repo.getAgency(staff.agencyId),
      request.requesterId ? repo.getRequester(staff.agencyId, request.requesterId) : null,
      repo.listMessages(staff.agencyId, input.requestId),
    ]);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Offline fallback: a serviceable template, clearly not model-drafted.
      const first = (requester?.name ?? "there").split(" ")[0];
      return {
        ok: true,
        subject: `Your records request ${request.publicId} — a quick question`,
        body: [
          `Hi ${first},`,
          ``,
          `Thanks for your request (${request.publicId}): "${request.rawText}"`,
          ``,
          `To find the right records, could you tell us a bit more about what you're looking for — for example the date range or department involved? A quick reply here speeds things up.`,
          ``,
          `${agency?.name ?? "Records Office"}`,
        ].join("\n"),
        aiDrafted: false,
        warnings: [],
      };
    }

    const { AnthropicModelClient } = await import("@/ai/modelClient");
    const { runPipeline } = await import("@/ai/runPipeline");
    const { correspondencePipeline } = await import("@/ai/pipelines/correspondence");
    const result = await runPipeline(
      correspondencePipeline,
      {
        kind: "clarification",
        context: {
          public_id: request.publicId,
          agency: agency?.name,
          requester_name: requester?.name,
          request_as_filed: request.rawText,
          interpreted_scope: request.interpretedScope,
          statutory_due_date: request.statutoryDueAt?.toDateString() ?? null,
          recent_thread: thread
            .filter((m) => m.direction !== "internal_note")
            .slice(-6)
            .map((m) => ({ from: m.direction === "outbound" ? "staff" : "requester", body: m.body })),
        },
      },
      { modelClient: new AnthropicModelClient(apiKey) },
    );
    return {
      ok: true,
      subject: result.output.subject,
      body: result.output.body,
      aiDrafted: true,
      aiMeta: { promptVersion: correspondencePipeline.promptVersion, model: result.model },
      warnings: result.output.warnings,
    };
  } catch (e) {
    console.error("draftReply failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Drafting failed." };
  }
}

export async function extendRequestAction(input: {
  agencySlug: string;
  requestId: string;
  days: number;
  reason: string;
  note?: string;
}): Promise<WorkspaceResult> {
  try {
    const { staff, deps } = await ctx(input.agencySlug);
    await extendRequest(deps, {
      agencyId: staff.agencyId,
      requestId: input.requestId,
      actorUserId: staff.userId, // the named human on the extension
      days: input.days,
      reason: input.reason,
      note: input.note,
    });
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ExtensionError) return { ok: false, error: e.message };
    return fail("extendRequest", e);
  }
}

export async function denyRequestAction(input: {
  agencySlug: string;
  requestId: string;
  exemptions: { citation: string; label?: string }[];
  noRecords?: boolean;
  explanation?: string;
  letterBody?: string;
  letterAiMeta?: { promptVersion: string; model: string };
}): Promise<WorkspaceResult> {
  try {
    const { staff, deps } = await ctx(input.agencySlug);
    await denyRequest(deps, {
      agencyId: staff.agencyId,
      requestId: input.requestId,
      actorUserId: staff.userId, // the named approver on the denial
      exemptions: input.exemptions,
      noRecords: input.noRecords,
      explanation: input.explanation,
      letterBody: input.letterBody,
      letterAiMeta: input.letterAiMeta,
    });
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ReleaseError) return { ok: false, error: e.message };
    return fail("denyRequest", e);
  }
}

export type DraftDenialResult =
  | {
      ok: true;
      body: string;
      aiDrafted: boolean;
      aiMeta?: { promptVersion: string; model: string };
      warnings: string[];
    }
  | { ok: false; error: string };

/**
 * Draft the denial letter (§6.6 kind "denial"): exemption citations and the
 * statute profile's appeal language ride in verbatim; the model writes the
 * connective prose. Without a key, the deterministic composition stands in.
 */
export async function draftDenialAction(input: {
  agencySlug: string;
  requestId: string;
  exemptions: { citation: string; label?: string }[];
  explanation?: string;
}): Promise<DraftDenialResult> {
  try {
    const { staff, repo } = await ctx(input.agencySlug);
    const request = await repo.getRequest(staff.agencyId, input.requestId);
    if (!request) return { ok: false, error: "Request not found." };
    if (input.exemptions.length === 0) {
      return { ok: false, error: "Pick at least one exemption citation to draft against." };
    }
    const [agency, requester] = await Promise.all([
      repo.getAgency(staff.agencyId),
      request.requesterId ? repo.getRequester(staff.agencyId, request.requesterId) : null,
    ]);
    const { getStateProfile } = await import("@/statute/profiles");
    const profile = agency ? getStateProfile(agency.stateCode) : null;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      const { composeDenialLetter } = await import("@/domain/denialLetter");
      return {
        ok: true,
        body: composeDenialLetter({
          publicId: request.publicId,
          agencyName: agency?.name ?? "the agency",
          requesterName: requester?.name,
          requestSummary: request.interpretedScope ?? request.rawText,
          exemptions: input.exemptions,
          appealProcess: profile?.appeal.process ?? null,
          appealDeadlineDays: profile?.appeal.deadlineDays ?? null,
          explanation: input.explanation,
        }),
        aiDrafted: false,
        warnings: [],
      };
    }

    const { AnthropicModelClient } = await import("@/ai/modelClient");
    const { runPipeline } = await import("@/ai/runPipeline");
    const { correspondencePipeline } = await import("@/ai/pipelines/correspondence");
    const result = await runPipeline(
      correspondencePipeline,
      {
        kind: "denial",
        context: {
          public_id: request.publicId,
          agency: agency?.name,
          requester_name: requester?.name,
          request_as_filed: request.rawText,
          interpreted_scope: request.interpretedScope,
          exemption_citations: input.exemptions.map((e) =>
            e.label ? `${e.citation} — ${e.label}` : e.citation,
          ),
          appeal_language_verbatim: profile?.appeal.process ?? null,
          appeal_deadline_days: profile?.appeal.deadlineDays ?? null,
          staff_explanation: input.explanation ?? null,
        },
      },
      { modelClient: new AnthropicModelClient(apiKey) },
    );
    return {
      ok: true,
      body: result.output.body,
      aiDrafted: true,
      aiMeta: { promptVersion: correspondencePipeline.promptVersion, model: result.model },
      warnings: result.output.warnings,
    };
  } catch (e) {
    console.error("draftDenial failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Drafting failed." };
  }
}

export async function finalizeRedactionAction(input: {
  agencySlug: string;
  requestId: string;
  documentId: string;
  spans: { line: number; startCol: number; endCol: number; reason: string }[];
  acceptResidualRisk?: boolean;
}): Promise<WorkspaceResult> {
  try {
    const { staff, deps } = await ctx(input.agencySlug);
    const { getBlobStore } = await import("@/adapters/blobStore");
    const { finalizeRedaction, RedactionError } = await import("@/services/redactionService");
    try {
      await finalizeRedaction(
        { ...deps, blobStore: getBlobStore() },
        {
          agencyId: staff.agencyId,
          requestId: input.requestId,
          documentId: input.documentId,
          actorUserId: staff.userId, // the named human who finalizes
          spans: input.spans,
          acceptResidualRisk: input.acceptResidualRisk,
        },
      );
    } catch (e) {
      if (e instanceof RedactionError) return { ok: false, error: e.message };
      throw e;
    }
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}/redact`);
    return { ok: true };
  } catch (e) {
    return fail("finalizeRedaction", e);
  }
}

export interface CopilotActionVM {
  type: "draft_message" | "propose_task" | "propose_extension" | "none";
  detail: string;
}

export type CopilotResult =
  | { ok: true; reply: string; actions: CopilotActionVM[]; aiMeta: { promptVersion: string; model: string } }
  | { ok: false; error: string };

/**
 * Coordinator copilot (§6.8): a chat turn scoped to this request. Proposals
 * come back as drafts; the panel's buttons land them on the same named-human
 * actions as everywhere else. Every run is logged to the audit trail.
 */
export async function copilotAction(input: {
  agencySlug: string;
  requestId: string;
  message: string;
  /** Condensed prior turns, oldest first ("coordinator: …" / "copilot: …"). */
  history?: string[];
}): Promise<CopilotResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "AI is not configured (ANTHROPIC_API_KEY)." };
  if (!input.message.trim()) return { ok: false, error: "Say something first." };
  try {
    const { staff, repo, deps } = await ctx(input.agencySlug);
    const request = await repo.getRequest(staff.agencyId, input.requestId);
    if (!request) return { ok: false, error: "Request not found." };
    const events = await repo.listEvents(staff.agencyId, input.requestId);

    const { AnthropicModelClient } = await import("@/ai/modelClient");
    const { runPipeline } = await import("@/ai/runPipeline");
    const { copilotPipeline } = await import("@/ai/pipelines/copilot");

    const history = (input.history ?? []).slice(-8);
    const message = history.length
      ? `Earlier in this chat:\n${history.join("\n")}\n\nNow: ${input.message.trim()}`
      : input.message.trim();

    const result = await runPipeline(
      copilotPipeline,
      {
        request: {
          publicId: request.publicId,
          interpretedScope: request.interpretedScope ?? request.rawText,
          status: request.status,
          dueDate: request.statutoryDueAt?.toDateString(),
          recentEvents: events.slice(-10).map((e) => e.summary),
        },
        message,
      },
      { modelClient: new AnthropicModelClient(apiKey) },
    );

    // Every pipeline run is auditable (§6/§10) — the copilot is no exception.
    await repo.appendEvent({
      id: deps.genId(),
      agencyId: staff.agencyId,
      requestId: input.requestId,
      kind: "ai_action",
      actorUserId: staff.userId, // the human who asked
      summary: "Copilot consulted",
      payload: {
        pipeline: "coordinator_copilot",
        promptVersion: copilotPipeline.promptVersion,
        model: result.model,
        proposedActions: result.output.proposedActions.map((a) => a.type),
      },
      createdAt: deps.now(),
    });

    return {
      ok: true,
      reply: result.output.reply,
      actions: result.output.proposedActions.filter((a) => a.type !== "none"),
      aiMeta: { promptVersion: copilotPipeline.promptVersion, model: result.model },
    };
  } catch (e) {
    console.error("copilot failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Copilot failed." };
  }
}

export async function reassignTaskAction(input: {
  agencySlug: string;
  requestId: string;
  taskId: string;
}): Promise<WorkspaceResult> {
  try {
    const { staff, deps } = await ctx(input.agencySlug);
    await reassignTask(deps, {
      agencyId: staff.agencyId,
      taskId: input.taskId,
      actorUserId: staff.userId,
    });
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    return { ok: true };
  } catch (e) {
    return fail("reassignTask", e);
  }
}
