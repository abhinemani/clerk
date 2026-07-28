/**
 * Session guards for server components and actions. Each guard either returns
 * the authorized principal or redirects to the right sign-in page — always the
 * agency's own (multi-tenant: there is no global login).
 */
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getRepository } from "@/db/createRepository";
import type { StaffRole } from "@/services/repository";

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

/**
 * Staff member of this agency, optionally restricted to certain roles. The
 * JWT only *identifies* the user; authority (role, continued existence) is
 * re-read from the database on every call — a demoted or removed staffer's
 * old token grants nothing.
 */
export async function requireStaff(agencySlug: string, roles?: StaffRole[]): Promise<StaffSession> {
  const session = await auth();
  const u = session?.user;
  if (!u || u.kind !== "staff" || u.agencySlug !== agencySlug || !u.role) {
    redirect(`/${agencySlug}/app/login`);
  }

  const repo = await getRepository();
  const dbUser = await repo.getUser(u.agencyId!, u.id);
  if (!dbUser) redirect(`/${agencySlug}/app/login`); // account removed
  if (roles && !roles.includes(dbUser.role)) redirect(`/${agencySlug}/app`);

  return {
    userId: dbUser.id,
    agencyId: dbUser.agencyId,
    agencySlug: u.agencySlug!,
    role: dbUser.role,
    name: dbUser.name ?? u.name ?? null,
    email: dbUser.email,
  };
}

/** Signed-in requester of this agency's portal. */
export async function requireRequester(agencySlug: string): Promise<RequesterSession> {
  const session = await auth();
  const u = session?.user;
  if (!u || u.kind !== "requester" || u.agencySlug !== agencySlug) {
    redirect(`/${agencySlug}/login`);
  }
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
}

/** Non-redirecting session peek for UI chrome (nav links, prefills). */
export async function sessionUser() {
  const session = await auth();
  return session?.user ?? null;
}
