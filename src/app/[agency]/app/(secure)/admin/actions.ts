"use server";

/**
 * Agency-admin roster actions. Every action re-derives the actor from the
 * server session and passes it to the account service, which enforces the
 * admin-of-this-agency rule again — the UI is not the security boundary.
 */
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import {
  AccountError,
  changeStaffRole,
  createStaffUser,
  inviteStaffUser,
} from "@/services/accountService";
import { defaultDeps } from "@/services/deps";
import type { StaffRole } from "@/services/repository";

export type AdminResult = { ok: true } | { ok: false; error: string };

async function actorFor(slug: string) {
  const staff = await requireStaff(slug, ["admin"]);
  const repo = await getRepository();
  const actor = await repo.getUser(staff.agencyId, staff.userId);
  if (!actor) throw new AccountError("Your account was not found.");
  return { actor, repo, agencyId: staff.agencyId };
}

/**
 * Add a colleague. With a password → account is live immediately. Without →
 * an invite link (via the outbox) lets them set their own; nobody hands
 * credentials around.
 */
export async function addStaffMember(input: {
  agencySlug: string;
  email: string;
  name: string;
  role: StaffRole;
  password?: string;
}): Promise<AdminResult> {
  try {
    const { actor, repo, agencyId } = await actorFor(input.agencySlug);
    const deps = defaultDeps(repo);
    if (input.password?.trim()) {
      await createStaffUser(deps, {
        agencyId,
        actor,
        email: input.email,
        name: input.name,
        role: input.role,
        password: input.password,
      });
    } else {
      const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
      await inviteStaffUser(deps, {
        agencyId,
        actor,
        email: input.email,
        name: input.name,
        role: input.role,
        inviteLinkBase: `${baseUrl}/${input.agencySlug}/reset`,
      });
    }
    revalidatePath(`/${input.agencySlug}/app/admin`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AccountError) return { ok: false, error: e.message };
    console.error("addStaffMember failed", e);
    return { ok: false, error: "Could not add the staff member." };
  }
}

export async function setStaffRole(input: {
  agencySlug: string;
  userId: string;
  role: StaffRole;
}): Promise<AdminResult> {
  try {
    const { actor, repo, agencyId } = await actorFor(input.agencySlug);
    await changeStaffRole(defaultDeps(repo), { agencyId, actor, userId: input.userId, role: input.role });
    revalidatePath(`/${input.agencySlug}/app/admin`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AccountError) return { ok: false, error: e.message };
    console.error("setStaffRole failed", e);
    return { ok: false, error: "Could not change the role." };
  }
}
