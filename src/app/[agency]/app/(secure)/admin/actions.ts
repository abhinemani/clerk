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

/**
 * Deterministic routing rules (src/domain/workflow.ts): keyword→department
 * policy applied at filing, no model in the loop. Admin-only; logged.
 */
export async function updateRoutingRulesAction(input: {
  agencySlug: string;
  rules: { departmentId: string; keywords: string }[];
}): Promise<AdminResult> {
  try {
    const { actor, repo, agencyId } = await actorFor(input.agencySlug);
    const departments = await repo.listDepartments(agencyId);
    const valid = new Set(departments.map((d) => d.id));
    const rules = input.rules
      .filter((r) => valid.has(r.departmentId))
      .map((r) => ({
        departmentId: r.departmentId,
        keywords: r.keywords
          .split(",")
          .map((k) => k.trim().toLowerCase())
          .filter((k) => k.length >= 2)
          .slice(0, 30),
      }))
      .filter((r) => r.keywords.length > 0);

    await repo.updateAgency(agencyId, { defaultRoutingRules: rules.length > 0 ? rules : null });
    const deptName = new Map(departments.map((d) => [d.id, d.name]));
    await repo.appendAdminEvent({
      id: crypto.randomUUID(),
      agencyId,
      kind: "routing_rules_changed",
      actorLabel: actor.name ?? actor.email,
      summary:
        rules.length > 0
          ? `Routing rules set for ${rules.map((r) => deptName.get(r.departmentId)).join(", ")}`
          : "Routing rules cleared",
      payload: { rules },
      createdAt: new Date(),
    });
    revalidatePath(`/${input.agencySlug}/app/admin`);
    return { ok: true };
  } catch (e) {
    console.error("updateRoutingRules failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Could not save routing rules." };
  }
}

/**
 * Workflow automation policy (src/domain/workflow.ts) — opt-in auto-assignment
 * and confidence-gated auto-dispatch. Admin-only; the change itself is logged
 * to the append-only admin audit.
 */
export async function updateWorkflowSettingsAction(input: {
  agencySlug: string;
  autoAssign: boolean;
  autoDispatch: boolean;
  autoDispatchConfidence: number;
  milestoneEmails: boolean;
}): Promise<AdminResult> {
  try {
    const { actor, repo, agencyId } = await actorFor(input.agencySlug);
    const threshold = Math.min(Math.max(input.autoDispatchConfidence, 0), 1);
    await repo.updateAgency(agencyId, {
      workflowSettings: {
        autoAssign: input.autoAssign,
        autoDispatch: input.autoDispatch,
        autoDispatchConfidence: threshold,
        milestoneEmails: input.milestoneEmails,
      },
    });
    await repo.appendAdminEvent({
      id: crypto.randomUUID(),
      agencyId,
      kind: "workflow_settings_changed",
      actorLabel: actor.name ?? actor.email,
      summary: `Workflow automation set: auto-assign ${input.autoAssign ? "on" : "off"}, auto-dispatch ${
        input.autoDispatch ? `on (confidence ≥ ${threshold})` : "off"
      }, milestone emails ${input.milestoneEmails ? "on" : "off"}`,
      payload: {
        autoAssign: input.autoAssign,
        autoDispatch: input.autoDispatch,
        autoDispatchConfidence: threshold,
        milestoneEmails: input.milestoneEmails,
      },
      createdAt: new Date(),
    });
    revalidatePath(`/${input.agencySlug}/app/admin`);
    return { ok: true };
  } catch (e) {
    console.error("updateWorkflowSettings failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Could not save settings." };
  }
}

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

/**
 * Department membership (department-scoped accounts): which departments a
 * staff member — in practice a responder — belongs to. Their /app/tasks view
 * shows exactly these departments' tasks.
 */
export async function setStaffDepartmentsAction(input: {
  agencySlug: string;
  userId: string;
  departmentIds: string[];
}): Promise<AdminResult> {
  try {
    const { actor, repo, agencyId } = await actorFor(input.agencySlug);
    const target = await repo.getUser(agencyId, input.userId);
    if (!target) return { ok: false, error: "That staff account was not found." };
    await repo.setUserDepartments(agencyId, input.userId, input.departmentIds);
    const departments = await repo.listDepartments(agencyId);
    const names = departments
      .filter((d) => input.departmentIds.includes(d.id))
      .map((d) => d.name);
    await repo.appendAdminEvent({
      id: crypto.randomUUID(),
      agencyId,
      kind: "staff_departments_changed",
      actorLabel: actor.name ?? actor.email,
      summary: `${target.name ?? target.email} now covers ${names.length > 0 ? names.join(", ") : "no departments"}`,
      payload: { userId: input.userId, departmentIds: input.departmentIds },
      createdAt: new Date(),
    });
    revalidatePath(`/${input.agencySlug}/app/admin`);
    return { ok: true };
  } catch (e) {
    console.error("setStaffDepartments failed", e);
    return { ok: false, error: "Could not update departments." };
  }
}

/**
 * Department management (onboarding): the custodians dispatch routes to.
 * Create + rename/re-address only — no delete, because tasks and routing
 * rules reference departments and history must keep resolving.
 */
export async function saveDepartmentAction(input: {
  agencySlug: string;
  id?: string;
  name: string;
  responderEmails?: string;
}): Promise<AdminResult> {
  try {
    const { actor, repo, agencyId } = await actorFor(input.agencySlug);
    const name = input.name.trim();
    if (!name) return { ok: false, error: "Give the department a name." };
    const defaultResponderEmails = (input.responderEmails ?? "")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e.includes("@"))
      .slice(0, 10);

    if (input.id) {
      await repo.updateDepartment(agencyId, input.id, { name, defaultResponderEmails });
    } else {
      await repo.createDepartment({
        id: crypto.randomUUID(),
        agencyId,
        name,
        defaultResponderEmails,
      });
    }
    await repo.appendAdminEvent({
      id: crypto.randomUUID(),
      agencyId,
      kind: "department_changed",
      actorLabel: actor.name ?? actor.email,
      summary: `${input.id ? "Updated" : "Created"} department: ${name}`,
      payload: { name, defaultResponderEmails },
      createdAt: new Date(),
    });
    revalidatePath(`/${input.agencySlug}/app/admin`);
    return { ok: true };
  } catch (e) {
    console.error("saveDepartment failed", e);
    return { ok: false, error: "Could not save the department." };
  }
}
