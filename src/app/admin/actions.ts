"use server";

/**
 * Platform-console actions — operator only. Every mutation re-checks the
 * platform session server-side; the agency-scoped rules do not apply here
 * (this is the one cross-tenant surface, per the port's warning).
 */
import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { signIn, signOut } from "@/auth";
import { requirePlatformAdmin } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import {
  AccountError,
  provisionAgency,
  resetStaffPassword,
} from "@/services/accountService";
import { defaultDeps } from "@/services/deps";
import type { StaffRole } from "@/services/repository";

export type PlatformResult = { ok: true } | { ok: false; error: string };
export type CreateAgencyResult = { ok: true; ingestKey: string } | { ok: false; error: string };

export async function platformSignIn(input: { email: string; password: string }): Promise<PlatformResult> {
  try {
    await signIn("credentials", {
      kind: "platform",
      agencySlug: "",
      email: input.email,
      password: input.password,
      redirectTo: "/admin",
    });
    return { ok: true }; // unreachable — signIn redirects on success
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: "Those credentials didn't match." };
    throw e; // NEXT_REDIRECT
  }
}

export async function platformSignOut(): Promise<void> {
  await signOut({ redirectTo: "/admin/login" });
}

export async function createAgencyAction(input: {
  name: string;
  slug: string;
  stateCode: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}): Promise<CreateAgencyResult> {
  await requirePlatformAdmin();
  try {
    const { ingestKey } = await provisionAgency(defaultDeps(await getRepository()), {
      name: input.name,
      slug: input.slug,
      stateCode: input.stateCode,
      admin: { name: input.adminName, email: input.adminEmail, password: input.adminPassword },
    });
    revalidatePath("/admin");
    return { ok: true, ingestKey };
  } catch (e) {
    if (e instanceof AccountError) return { ok: false, error: e.message };
    console.error("createAgencyAction failed", e);
    return { ok: false, error: "Could not create the agency." };
  }
}

export async function platformSetStaffRole(input: {
  agencyId: string;
  agencySlug: string;
  userId: string;
  role: StaffRole;
}): Promise<PlatformResult> {
  await requirePlatformAdmin();
  try {
    const repo = await getRepository();
    await repo.updateUser(input.agencyId, input.userId, { role: input.role });
    revalidatePath(`/admin/${input.agencySlug}`);
    return { ok: true };
  } catch (e) {
    console.error("platformSetStaffRole failed", e);
    return { ok: false, error: "Could not change the role." };
  }
}

export async function platformResetPassword(input: {
  agencyId: string;
  agencySlug: string;
  userId: string;
  password: string;
}): Promise<PlatformResult> {
  await requirePlatformAdmin();
  try {
    await resetStaffPassword(defaultDeps(await getRepository()), {
      agencyId: input.agencyId,
      userId: input.userId,
      password: input.password,
      actorLabel: "platform operator",
    });
    revalidatePath(`/admin/${input.agencySlug}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AccountError) return { ok: false, error: e.message };
    console.error("platformResetPassword failed", e);
    return { ok: false, error: "Could not reset the password." };
  }
}

/**
 * Link a directory entry to another tenant on this deployment (referral
 * phase 3). PLATFORM SCOPE ON PURPOSE: knowing which agencies share a
 * deployment is the operator's knowledge, not any single tenant's — agency
 * admins see the link read-only in their directory manager.
 */
export async function linkDirectoryPeerAction(input: {
  agencyId: string;
  agencySlug: string;
  entryId: string;
  peerAgencyId: string | null;
}): Promise<PlatformResult> {
  await requirePlatformAdmin();
  try {
    const repo = await getRepository();
    if (input.peerAgencyId === input.agencyId) {
      return { ok: false, error: "An entry cannot forward to its own agency." };
    }
    if (input.peerAgencyId) {
      const peer = await repo.getAgency(input.peerAgencyId);
      if (!peer) return { ok: false, error: "That agency no longer exists." };
    }
    const entry = await repo.updateDirectoryEntry(input.agencyId, input.entryId, {
      peerAgencyId: input.peerAgencyId,
    });
    await repo.appendAdminEvent({
      id: crypto.randomUUID(),
      agencyId: input.agencyId,
      kind: "directory_changed",
      actorLabel: "platform operator",
      summary: input.peerAgencyId
        ? `Linked directory entry "${entry.name}" to a Clerk tenant — forwarding enabled`
        : `Unlinked directory entry "${entry.name}" — forwarding disabled`,
      payload: { entryId: input.entryId, peerAgencyId: input.peerAgencyId },
      createdAt: new Date(),
    });
    revalidatePath(`/admin/${input.agencySlug}`);
    return { ok: true };
  } catch (e) {
    console.error("linkDirectoryPeer failed", e);
    return { ok: false, error: "Could not update the link." };
  }
}
