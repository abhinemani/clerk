"use server";

/**
 * Tenant portal server actions — filing, tracking, and account flows, always
 * scoped to the agency in the URL. Filing goes through the real service layer
 * (`submitRequest`): public id, statutory deadline, audit events. A signed-in
 * resident's filing is attached to their account server-side (never trusted
 * from the client); anonymous filing remains a first-class path (spec §3).
 */
import { AuthError } from "next-auth";
import { auth, signIn, signOut } from "@/auth";
import { getRepository } from "@/db/createRepository";
import { ensureAgency } from "@/lib/bootstrap";
import { trackByPublicId } from "@/lib/live";
import { registerRequester, AccountError } from "@/services/accountService";
import { defaultDeps } from "@/services/deps";
import type { RequesterType } from "@/services/repository";
import { submitRequest } from "@/services/requestService";

async function resolveAgencyId(slug: string): Promise<string | null> {
  // The demo agency bootstraps itself on first use; every other tenant is
  // provisioned through the platform console.
  if (slug === "riverton") return (await ensureAgency()).agencyId;
  const repo = await getRepository();
  return (await repo.getAgencyBySlug(slug))?.id ?? null;
}

export type FileRequestResult =
  | { ok: true; publicId: string; dueAtISO: string | null }
  | { ok: false; error: string };

export async function fileRequest(input: {
  agencySlug: string;
  text: string;
  name?: string;
  email?: string;
  type?: RequesterType;
}): Promise<FileRequestResult> {
  const rawText = input.text?.trim() ?? "";
  if (rawText.length < 3) return { ok: false, error: "Tell us what records you're looking for." };

  try {
    const agencyId = await resolveAgencyId(input.agencySlug);
    if (!agencyId) return { ok: false, error: "Unknown agency." };
    const deps = defaultDeps(await getRepository());

    // Attach the signed-in resident (if any) from the server-side session.
    const session = await auth();
    const u = session?.user;
    const signedInRequester =
      u && u.kind === "requester" && u.agencySlug === input.agencySlug ? u : null;

    const request = await submitRequest(deps, {
      agencyId,
      rawText,
      requester: signedInRequester
        ? { email: signedInRequester.email ?? undefined, name: signedInRequester.name ?? undefined }
        : {
            email: input.email?.trim() || undefined,
            name: input.name?.trim() || undefined,
            type: input.type,
          },
    });

    // Deterministic routing rules first (explicit agency policy, no model):
    // matches become proposal cards, and — with auto-dispatch on — the
    // department tasks go out before the resident leaves the page. Advisory
    // failure only; filing never blocks on it.
    try {
      const { applyAgencyRoutingRules } = await import("@/services/taskService");
      await applyAgencyRoutingRules(deps, { agencyId, requestId: request.id, rawText });
    } catch (e) {
      console.error("routing rules failed", e);
    }

    // Learned routing second (docs/learning-loop.md): the agency's own
    // resolved history as a play match — precedent stats as a card, and
    // an earned-confidence route into the same auto-dispatch gate (whose
    // tasks-already-exist guard keeps this advisory when a rule fired).
    // Deterministic, no model; advisory failure only.
    try {
      const { applyPlayRouting } = await import("@/services/learningService");
      await applyPlayRouting(deps, { agencyId, requestId: request.id, rawText });
    } catch (e) {
      console.error("play routing failed", e);
    }

    // AI proposes off the request path: queue intake triage (§6.1). The job
    // no-ops without ANTHROPIC_API_KEY.
    const { getJobQueue } = await import("@/jobs/queue");
    getJobQueue().enqueue("intake_triage", { agencyId, requestId: request.id });

    // Duplicate & related detection (§6.2) on STORED ask vectors — the
    // request's own vector was written moments ago in submitRequest, so the
    // common case costs zero embed calls; rows without vectors degrade to
    // token overlap inside the service. Advisory only — a failure never
    // blocks filing.
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

    return { ok: true, publicId: request.publicId, dueAtISO: request.statutoryDueAt?.toISOString() ?? null };
  } catch (e) {
    console.error("fileRequest failed", e);
    return { ok: false, error: "Something went wrong filing your request. Please try again." };
  }
}

export interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  subject: string | null;
  body: string;
  atISO: string;
}

export type TrackResult =
  | {
      found: true;
      publicId: string;
      status: string;
      receivedAtISO: string;
      dueAtISO: string;
      daysLeft: number;
      /** Released files, when the request has a release the viewer may fetch. */
      artifacts: { filename: string; url: string }[];
      /** Statutory extension taken, if any — invariant 7 says every deadline
       *  move has a basis; the requester gets to see it. */
      extension: { days: number; reason: string; atISO: string } | null;
      /** Requester-safe milestones (status changes + extension), oldest first.
       *  Internal notes, task traffic, and staff names never appear here. */
      timeline: { label: string; atISO: string }[];
      /**
       * Correspondence — present ONLY when the viewer is signed in as the
       * verified requester who owns this request. Tracking numbers are
       * guessable; messages never travel on the number alone.
       */
      thread?: { requestId: string; messages: ThreadMessage[] };
      /** Set when this request was forwarded to a peer agency on this
       *  deployment (referral phase 3) — where it lives now. */
      forwardedTo?: { agencyName: string; publicId: string; trackPath: string } | null;
    }
  | { found: false };

export async function trackRequest(agencySlug: string, publicId: string): Promise<TrackResult> {
  const hit = await trackByPublicId(agencySlug, publicId.trim());
  if (!hit) return { found: false };
  const daysLeft = Math.round((hit.dueAt.getTime() - hit.now.getTime()) / 86_400_000);

  let artifacts: { filename: string; url: string }[] = [];
  let thread: { requestId: string; messages: ThreadMessage[] } | undefined;
  let extension: { days: number; reason: string; atISO: string } | null = null;
  let timeline: { label: string; atISO: string }[] = [];
  let forwardedTo: { agencyName: string; publicId: string; trackPath: string } | null = null;
  try {
    const repo = await getRepository();
    const agency = await repo.getAgencyBySlug(agencySlug);
    const request = agency
      ? await repo.findRequestByPublicId(agency.id, publicId.trim().toUpperCase())
      : null;
    if (agency && request) {
      // Transparency (spec "no black hole"): the deadline's history is the
      // requester's to see. Extensions carry their statutory basis.
      const taken = request.extensionHistory?.[0];
      if (taken) {
        extension = { days: taken.days, reason: taken.reason, atISO: new Date(taken.at).toISOString() };
      }
      // Forwarded to a peer tenant (phase 3): point the requester at its new
      // home. Rendered from the denormalized snapshot — no cross-tenant read.
      if (request.forwardedTo) {
        forwardedTo = {
          agencyName: request.forwardedTo.agencyName,
          publicId: request.forwardedTo.publicId,
          trackPath: `/${request.forwardedTo.agencySlug}/track?id=${encodeURIComponent(request.forwardedTo.publicId)}`,
        };
      }
      const { requestStatusLabel } = await import("@/lib/format");
      const events = await repo.listEvents(agency.id, request.id);
      timeline = events
        .filter((e) => e.kind === "status_change" || e.kind === "extension")
        .map((e) => ({
          label:
            e.kind === "extension"
              ? `Response deadline extended${extension ? ` by ${extension.days} days` : ""}`
              : typeof e.payload?.to === "string"
                ? requestStatusLabel(e.payload.to as string)
                : e.summary,
          atISO: e.createdAt.toISOString(),
        }));

      // Released records: surface download links (the file endpoint enforces
      // who may actually fetch — public releases for anyone, private for the
      // owner).
      if (hit.status === "fulfilled" || hit.status === "partially_fulfilled") {
        const releases = await repo.listReleases(agency.id, request.id);
        artifacts = releases.flatMap((rel) =>
          rel.artifacts
            .filter((a) => a.documentId)
            .map((a) => ({ filename: a.filename, url: `/${agencySlug}/files/${a.documentId}` })),
        );
      }

      // The message thread, for the authenticated owner only. Internal notes
      // never leave the staff workspace.
      const session = await auth();
      const u = session?.user;
      if (
        u &&
        u.kind === "requester" &&
        u.agencySlug === agencySlug &&
        request.requesterId &&
        request.requesterId === u.id
      ) {
        const requester = await repo.getRequester(agency.id, u.id);
        if (requester?.emailVerifiedAt != null) {
          const msgs = await repo.listMessages(agency.id, request.id);
          thread = {
            requestId: request.id,
            messages: msgs
              .filter((m) => m.direction !== "internal_note")
              .map((m) => ({
                id: m.id,
                direction: m.direction as "inbound" | "outbound",
                subject: m.subject,
                body: m.body,
                atISO: m.sentAt.toISOString(),
              })),
          };
        }
      }
    }
  } catch (e) {
    console.error("trackRequest extras failed", e);
  }

  return {
    found: true,
    publicId: hit.publicId,
    status: hit.status,
    receivedAtISO: hit.receivedAt.toISOString(),
    dueAtISO: hit.dueAt.toISOString(),
    daysLeft,
    artifacts,
    extension,
    timeline,
    thread,
    forwardedTo,
  };
}

export type ReplyResult = { ok: true } | { ok: false; error: string };

/** A signed-in requester replies to the records office from the tracker. */
export async function replyToRequestAction(input: {
  agencySlug: string;
  requestId: string;
  body: string;
}): Promise<ReplyResult> {
  const { postRequesterReply, MessageError } = await import("@/services/messageService");
  try {
    const session = await auth();
    const u = session?.user;
    if (!u || u.kind !== "requester" || u.agencySlug !== input.agencySlug) {
      return { ok: false, error: "Sign in to reply." };
    }
    const repo = await getRepository();
    const agency = await repo.getAgencyBySlug(input.agencySlug);
    if (!agency) return { ok: false, error: "Unknown agency." };
    // Ownership is re-checked inside the service — never trusted from the client.
    await postRequesterReply(defaultDeps(repo), {
      agencyId: agency.id,
      requestId: input.requestId,
      requesterId: u.id,
      body: input.body,
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof MessageError) return { ok: false, error: e.message };
    console.error("replyToRequest failed", e);
    return { ok: false, error: "Couldn't send your reply. Please try again." };
  }
}

// --- public archive + deflection (§6.7) ------------------------------------

export async function searchArchiveAction(agencySlug: string, query: string) {
  const { searchArchiveDetailed } = await import("@/lib/archive");
  const r = await searchArchiveDetailed(agencySlug, query);
  const { describeRange } = await import("@/domain/dateQuery");
  return {
    items: r.items,
    // Say out loud that a window was applied. A filter the user cannot see is
    // indistinguishable from a corpus that is missing records.
    window: r.range ? { label: describeRange(r.range), subject: r.subject } : null,
    matchedByAsk: r.matchedByAsk,
  };
}

/**
 * "Has someone asked this before?" — runs at the moment the archive comes up
 * empty, which is exactly the moment before a resident files. Deliberately
 * NOT on every keystroke: the judge costs a model call, and this is the one
 * point where its answer changes what the person does next.
 *
 * Audience is "requester", so private releases are never even candidates.
 */
export async function findPriorAnswersAction(agencySlug: string, ask: string) {
  const [{ getRepository }, { findPriorAnswers }] = await Promise.all([
    import("@/db/createRepository"),
    import("@/services/priorAnswerService"),
  ]);
  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(agencySlug);
  if (!agency) return { matches: [] as PriorAnswerCard[], judged: false };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let modelClient;
  if (apiKey) {
    const { AnthropicModelClient } = await import("@/ai/modelClient");
    modelClient = new AnthropicModelClient(apiKey);
  }

  const r = await findPriorAnswers({ repo }, {
    agencyId: agency.id,
    ask,
    audience: "requester",
    modelClient,
  });
  return {
    judged: r.judged,
    matches: r.matches.map((m) => ({
      publicId: m.publicId,
      coverage: m.coverage,
      rationale: m.rationale,
      documents: m.documents,
    })) satisfies PriorAnswerCard[],
  };
}

export interface PriorAnswerCard {
  publicId: string;
  coverage: "full" | "partial";
  rationale: string;
  documents: Array<{ id: string; title: string }>;
}

export type AgentTurnResult =
  | { enabled: false }
  | {
      enabled: true;
      intent: "answer" | "clarify" | "draft_request";
      message: string;
      /** Cited archive records, downloadable — the deflection payload. */
      items: import("@/lib/archive").ArchiveItem[];
      suggestedRequest: string | null;
    };

/**
 * One turn of the §6.7 requester agent: answer from the public archive,
 * ask a narrowing question, or draft a formal request. Retrieval is the same
 * public-only archive search as the instant results (invariant 3); the agent
 * validates its citations against what retrieval actually returned. Without
 * an AI key the portal quietly keeps its search-only behavior.
 */
export async function askRecordsAgentAction(input: {
  agencySlug: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  message: string;
}): Promise<AgentTurnResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { enabled: false };
  const message = input.message.trim().slice(0, 2000);
  if (!message) return { enabled: false };

  const [{ searchArchive }, { converse }, { AnthropicModelClient }] = await Promise.all([
    import("@/lib/archive"),
    import("@/ai/pipelines/requesterAgent"),
    import("@/ai/modelClient"),
  ]);

  // Retriever port over the tenant's public archive search. Everything
  // searchArchive returns is classification='public' by construction.
  const found = new Map<string, import("@/lib/archive").ArchiveItem>();
  const retriever = {
    async search(query: string, opts?: { limit?: number }) {
      const items = await searchArchive(input.agencySlug, query);
      for (const it of items) found.set(it.id, it);
      return items.slice(0, opts?.limit ?? 5).map((it, rank) => ({
        id: it.id,
        title: it.title,
        score: 1 / (rank + 1),
        whyMatched: it.summary.slice(0, 120),
        classification: "public" as const,
        snippet: `${it.summary} ${it.keywords.join(" ")}`.slice(0, 300),
      }));
    },
  };

  try {
    const result = await converse(
      { retriever, pipelineOpts: { modelClient: new AnthropicModelClient(apiKey) } },
      { history: input.history.slice(-12), message },
    );
    return {
      enabled: true,
      intent: result.output.intent,
      message: result.output.message,
      items: result.output.citations
        .map((id) => found.get(id))
        .filter((it): it is import("@/lib/archive").ArchiveItem => it != null),
      suggestedRequest: result.output.suggestedRequest,
    };
  } catch (e) {
    console.error("requester agent turn failed", e);
    return { enabled: false }; // degrade to search-only, never block the resident
  }
}

/**
 * Pre-filing check (§6.2 deflection): records already public that may answer
 * the draft request. PUBLIC CORPUS ONLY by construction (invariant 3) — this
 * surface never reveals other requests, only the archive.
 */
export async function checkAlreadyReleasedAction(agencySlug: string, text: string) {
  const { searchArchive } = await import("@/lib/archive");
  const items = await searchArchive(agencySlug, text);
  // Downloadable records first — a summary can inform, but a file deflects.
  return [...items].sort((a, b) => Number(b.downloadUrl != null) - Number(a.downloadUrl != null)).slice(0, 3);
}

/**
 * Log a deflection (download served / request narrowed) — the ROI number.
 * Fire-and-forget from the portal; never blocks the resident.
 */
export async function logDeflectionAction(input: {
  agencySlug: string;
  kind: "download" | "scope_down" | "archive_miss";
  query?: string;
  documentId?: string;
}): Promise<void> {
  try {
    const repo = await getRepository();
    const agency = await repo.getAgencyBySlug(input.agencySlug);
    if (!agency) return; // demo fixture — nothing to log against
    const { logDeflection } = await import("@/services/deflectionService");
    await logDeflection(defaultDeps(repo), {
      agencyId: agency.id,
      kind: input.kind,
      query: input.query,
      documentId: input.documentId,
    });
  } catch (e) {
    console.error("logDeflection failed", e);
  }
}

// --- account flows ---------------------------------------------------------

export type AuthResult = { ok: true } | { ok: false; error: string };

/** Resident sign-in → their account page. */
export async function requesterSignIn(input: {
  agencySlug: string;
  email: string;
  password: string;
}): Promise<AuthResult> {
  return credentialsSignIn({ ...input, kind: "requester", redirectTo: `/${input.agencySlug}/account` });
}

/** Staff sign-in → the workspace. */
export async function staffSignIn(input: {
  agencySlug: string;
  email: string;
  password: string;
}): Promise<AuthResult> {
  return credentialsSignIn({ ...input, kind: "staff", redirectTo: `/${input.agencySlug}/app` });
}

/** Resident registration; signs them in on success. */
export async function requesterRegister(input: {
  agencySlug: string;
  email: string;
  name: string;
  password: string;
}): Promise<AuthResult> {
  try {
    const agencyId = await resolveAgencyId(input.agencySlug);
    if (!agencyId) return { ok: false, error: "Unknown agency." };
    const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
    await registerRequester(defaultDeps(await getRepository()), {
      agencyId,
      email: input.email,
      name: input.name,
      password: input.password,
      verifyLinkBase: `${baseUrl}/${input.agencySlug}/verify`,
    });
  } catch (e) {
    if (e instanceof AccountError) return { ok: false, error: e.message };
    console.error("requesterRegister failed", e);
    return { ok: false, error: "Registration failed. Please try again." };
  }
  return credentialsSignIn({
    agencySlug: input.agencySlug,
    kind: "requester",
    email: input.email,
    password: input.password,
    redirectTo: `/${input.agencySlug}/account`,
  });
}

export async function portalSignOut(agencySlug: string): Promise<void> {
  await signOut({ redirectTo: `/${agencySlug}` });
}

/** Start a self-service reset. Always "succeeds" — no account enumeration. */
export async function forgotPasswordAction(input: {
  agencySlug: string;
  principal: "requester" | "staff";
  email: string;
}): Promise<void> {
  try {
    const repo = await getRepository();
    const agency = await repo.getAgencyBySlug(input.agencySlug);
    if (!agency) return;
    const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
    const { requestPasswordReset } = await import("@/services/accountService");
    await requestPasswordReset(defaultDeps(repo), {
      agencyId: agency.id,
      principal: input.principal,
      email: input.email,
      resetLinkBase: `${baseUrl}/${input.agencySlug}/reset`,
    });
  } catch (e) {
    console.error("forgotPassword failed", e); // still silent to the caller
  }
}

export async function resetPasswordAction(input: {
  agencySlug: string;
  token: string;
  kind: "reset_requester" | "reset_staff" | "staff_invite";
  password: string;
}): Promise<AuthResult> {
  try {
    // Scope redemption to the agency whose reset page this is — a link minted
    // by one tenant must not be redeemable through another tenant's page.
    const agencyId = await resolveAgencyId(input.agencySlug);
    if (!agencyId) return { ok: false, error: "That link is invalid or expired — request a new one." };
    const { completePasswordReset } = await import("@/services/accountService");
    const ok = await completePasswordReset(defaultDeps(await getRepository()), {
      agencyId,
      rawToken: input.token,
      kind: input.kind,
      password: input.password,
    });
    if (!ok) return { ok: false, error: "That link is invalid or expired — request a new one." };
    return { ok: true };
  } catch (e) {
    if (e instanceof AccountError) return { ok: false, error: e.message };
    console.error("resetPassword failed", e);
    return { ok: false, error: "Could not reset the password. Please try again." };
  }
}

async function credentialsSignIn(input: {
  agencySlug: string;
  kind: "staff" | "requester" | "platform";
  email: string;
  password: string;
  redirectTo: string;
}): Promise<AuthResult> {
  try {
    await signIn("credentials", {
      agencySlug: input.agencySlug,
      kind: input.kind,
      email: input.email,
      password: input.password,
      redirectTo: input.redirectTo,
    });
    return { ok: true }; // unreachable — signIn redirects on success
  } catch (e) {
    if (e instanceof AuthError) {
      return { ok: false, error: "That email and password combination didn't match." };
    }
    throw e; // NEXT_REDIRECT — success; let Next complete the redirect
  }
}
