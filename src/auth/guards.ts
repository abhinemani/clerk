/**
 * Session guards for server components and actions. Each guard either returns
 * the authorized principal or redirects to the right sign-in page — always the
 * agency's own (multi-tenant: there is no global login).
 */
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getRepository } from "@/db/createRepository";
import { getInstanceId } from "@/lib/instance";
import type { StaffRole } from "@/services/repository";

/**
 * A token is only as good as the database it was minted against: the `inst`
 * claim must match THIS instance (src/lib/instance.ts). Tokens without the
 * claim (pre-hardening sessions) or with another database's id are treated
 * as signed out — one forced re-login, then cross-database cookies are dead.
 */
async function instanceMatches(inst: string | undefined): Promise<boolean> {
  return inst != null && inst === (await getInstanceId());
}

export interface StaffSession {
  userId: string;
  agencyId: string;
  agencySlug: string;
  role: StaffRole;
  name: string | null;
  email: string | null;
}

export interface RequesterSession {
  requesterId: string;
  agencyId: string;
  agencySlug: string;
  name: string | null;
  email: string | null;
}

/** Every staff role — pass to requireStaff to mean "authenticate only". */
export const ALL_STAFF_ROLES: StaffRole[] = [
  "admin",
  "coordinator",
  "reviewer",
  "responder",
  "read_only",
];

/**
 * Staff member of this agency, optionally restricted to certain roles. The
 * JWT only *identifies* the user; authority (role, continued existence) is
 * re-read from the database on every call — a demoted or removed staffer's
 * old token grants nothing.
 *
 * Responders are DEFAULT-DENIED: with no `roles` list, a responder is sent to
 * their department task list instead of the coordinator surface. A page that
 * genuinely serves responders opts in by passing a roles list that includes
 * "responder" (or ALL_STAFF_ROLES). New coordinator pages are safe by default.
 */
export async function requireStaff(agencySlug: string, roles?: StaffRole[]): Promise<StaffSession> {
  // The authenticate-and-load half is request-cached (layout + page + nested
  // components each call this guard); the ROLE check stays per-call — pages
  // pass different `roles` lists and each must enforce its own.
  const { dbUser, tokenName, tokenSlug } = await loadStaffPrincipal(agencySlug);
  if (!roles && dbUser.role === "responder") redirect(`/${agencySlug}/app/tasks`);
  if (roles && !roles.includes(dbUser.role)) {
    redirect(dbUser.role === "responder" ? `/${agencySlug}/app/tasks` : `/${agencySlug}/app`);
  }

  return {
    userId: dbUser.id,
    agencyId: dbUser.agencyId,
    agencySlug: tokenSlug,
    role: dbUser.role,
    name: dbUser.name ?? tokenName,
    email: dbUser.email,
  };
}

/** Session decode + DB authority re-read, once per request per slug. */
const loadStaffPrincipal = cache(async (agencySlug: string) => {
  const session = await auth();
  const u = session?.user;
  if (!u || u.kind !== "staff" || u.agencySlug !== agencySlug || !u.role) {
    redirect(`/${agencySlug}/app/login`);
  }
  if (!(await instanceMatches(u.inst))) redirect(`/${agencySlug}/app/login`);

  const repo = await getRepository();
  const dbUser = await repo.getUser(u.agencyId!, u.id);
  if (!dbUser) redirect(`/${agencySlug}/app/login`); // account removed
  // No password on file = sign-in was revoked (a session can only exist if a
  // password once did) — the old token grants nothing, effective immediately.
  if (!dbUser.passwordHash) redirect(`/${agencySlug}/app/login`);
  return { dbUser, tokenName: u.name ?? null, tokenSlug: u.agencySlug! };
});

/** Signed-in requester of this agency's portal. */
export async function requireRequester(agencySlug: string): Promise<RequesterSession> {
  const session = await auth();
  const u = session?.user;
  if (!u || u.kind !== "requester" || u.agencySlug !== agencySlug) {
    redirect(`/${agencySlug}/login`);
  }
  if (!(await instanceMatches(u.inst))) redirect(`/${agencySlug}/login`);
  return {
    requesterId: u.id,
    agencyId: u.agencyId!,
    agencySlug: u.agencySlug!,
    name: u.name ?? null,
    email: u.email ?? null,
  };
}

/** The platform operator (cross-tenant console at /admin). */
export async function requirePlatformAdmin(): Promise<void> {
  const session = await auth();
  if (session?.user?.kind !== "platform") redirect("/admin/login");
  if (!(await instanceMatches(session.user.inst))) redirect("/admin/login");
}

/**
 * Non-redirecting session peek for UI chrome (nav links, prefills). Applies
 * the SAME instance check as the guards — otherwise the header says
 * "Signed in as X" from a stale cookie the guards would reject, and the
 * chrome lies about a session that grants nothing.
 */
export const sessionUser = cache(async () => {
  const session = await auth();
  const u = session?.user ?? null;
  if (!u) return null;
  return (await instanceMatches(u.inst)) ? u : null;
});
