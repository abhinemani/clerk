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

    // AI proposes off the request path: queue intake triage (§6.1). The job
    // no-ops without ANTHROPIC_API_KEY.
    const { getJobQueue } = await import("@/jobs/queue");
    getJobQueue().enqueue("intake_triage", { agencyId, requestId: request.id });

    return { ok: true, publicId: request.publicId, dueAtISO: request.statutoryDueAt?.toISOString() ?? null };
  } catch (e) {
    console.error("fileRequest failed", e);
    return { ok: false, error: "Something went wrong filing your request. Please try again." };
  }
}

export type TrackResult =
  | { found: true; publicId: string; status: string; receivedAtISO: string; dueAtISO: string; daysLeft: number }
  | { found: false };

export async function trackRequest(agencySlug: string, publicId: string): Promise<TrackResult> {
  const hit = await trackByPublicId(agencySlug, publicId.trim());
  if (!hit) return { found: false };
  const daysLeft = Math.round((hit.dueAt.getTime() - hit.now.getTime()) / 86_400_000);
  return {
    found: true,
    publicId: hit.publicId,
    status: hit.status,
    receivedAtISO: hit.receivedAt.toISOString(),
    dueAtISO: hit.dueAt.toISOString(),
    daysLeft,
  };
}

// --- public archive + deflection (§6.7) ------------------------------------

export async function searchArchiveAction(agencySlug: string, query: string) {
  const { searchArchive } = await import("@/lib/archive");
  return searchArchive(agencySlug, query);
}

/**
 * Log a deflection (download served / request narrowed) — the ROI number.
 * Fire-and-forget from the portal; never blocks the resident.
 */
export async function logDeflectionAction(input: {
  agencySlug: string;
  kind: "download" | "scope_down";
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
