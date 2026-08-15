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

/**
 * Branding (per-tenant identity): office name/contact, accent color
 * (contrast-guarded — white ink must clear AA on it), and the seal image
 * (PNG/JPEG only, size-capped, virus-scanned like every other upload).
 */
export async function saveBrandingAction(input: {
  agencySlug: string;
  officeName?: string;
  contactEmail?: string;
  addressLines?: string; // newline-separated
  hours?: string;
  accentColor?: string; // empty = clear
}): Promise<AdminResult> {
  try {
    const { actor, repo, agencyId } = await actorFor(input.agencySlug);
    const agency = await repo.getAgency(agencyId);
    const prev = agency?.branding ?? {};

    let accentColor: string | undefined;
    const rawAccent = input.accentColor?.trim();
    if (rawAccent) {
      const { checkAccentColor } = await import("@/domain/branding");
      const check = checkAccentColor(rawAccent);
      if (!check.ok) {
        return {
          ok: false,
          error:
            check.reason === "too_light"
              ? "That color is too light — white text on it wouldn't meet accessibility contrast (WCAG AA). Pick a darker shade."
              : "Enter a hex color like #1e3a5f.",
        };
      }
      accentColor = check.normalized;
    }

    await repo.updateAgency(agencyId, {
      branding: {
        ...prev,
        officeName: input.officeName?.trim() || undefined,
        contactEmail: input.contactEmail?.trim() || undefined,
        addressLines: (input.addressLines ?? "")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 4),
        hours: input.hours?.trim() || undefined,
        accentColor,
      },
    });
    await repo.appendAdminEvent({
      id: crypto.randomUUID(),
      agencyId,
      kind: "branding_changed",
      actorLabel: actor.name ?? actor.email,
      summary: "Updated portal branding",
      payload: { accentColor: accentColor ?? null },
      createdAt: new Date(),
    });
    revalidatePath(`/${input.agencySlug}`, "layout");
    return { ok: true };
  } catch (e) {
    console.error("saveBranding failed", e);
    return { ok: false, error: "Could not save branding." };
  }
}

const SEAL_MAX_BYTES = 1024 * 1024; // 1 MB — it's a header image, not an archive
const SEAL_TYPES = new Set(["image/png", "image/jpeg"]);

export async function uploadSealAction(formData: FormData): Promise<AdminResult> {
  try {
    const agencySlug = String(formData.get("agencySlug") ?? "");
    const file = formData.get("seal");
    if (!(file instanceof File)) return { ok: false, error: "Choose an image file." };
    if (!SEAL_TYPES.has(file.type)) return { ok: false, error: "PNG or JPEG only." };
    if (file.size > SEAL_MAX_BYTES) return { ok: false, error: "Keep the seal under 1 MB." };

    const { actor, repo, agencyId } = await actorFor(agencySlug);
    const bytes = Buffer.from(await file.arrayBuffer());

    // Same rule as every upload in the product: unscanned bytes are never
    // stored (fail-closed — spec §4).
    const { assertUploadable, getVirusScanner } = await import("@/adapters/virusScan");
    await assertUploadable(getVirusScanner(), bytes, file.name);

    const { blobKey, getBlobStore } = await import("@/adapters/blobStore");
    const key = blobKey(agencyId, `seal-${Date.now()}-${file.name}`);
    await getBlobStore().put(key, bytes, file.type);

    const agency = await repo.getAgency(agencyId);
    await repo.updateAgency(agencyId, {
      branding: { ...(agency?.branding ?? {}), sealBlobRef: key },
    });
    await repo.appendAdminEvent({
      id: crypto.randomUUID(),
      agencyId,
      kind: "branding_changed",
      actorLabel: actor.name ?? actor.email,
      summary: "Uploaded a new agency seal",
      payload: { filename: file.name, bytes: file.size },
      createdAt: new Date(),
    });
    revalidatePath(`/${agencySlug}`, "layout");
    return { ok: true };
  } catch (e) {
    console.error("uploadSeal failed", e);
    const message = e instanceof Error ? e.message : "Could not upload the seal.";
    return { ok: false, error: message };
  }
}

/**
 * Counsel sign-off (trust surface): the agency records WHO reviewed the
 * statute profile its deadlines run on, and WHEN. Display-only everywhere
 * else — recording it is the admin attesting on the record, so it's audited.
 */
export async function recordStatuteReviewAction(input: {
  agencySlug: string;
  reviewedBy: string;
  reviewedOn: string; // YYYY-MM-DD
  note?: string;
}): Promise<AdminResult> {
  try {
    const { actor, repo, agencyId } = await actorFor(input.agencySlug);
    const reviewedBy = input.reviewedBy.trim();
    if (!reviewedBy) return { ok: false, error: "Name the reviewer — that's the point." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reviewedOn)) {
      return { ok: false, error: "Give the review date as YYYY-MM-DD." };
    }
    const agency = await repo.getAgency(agencyId);
    await repo.updateAgency(agencyId, {
      settings: {
        ...(agency?.settings ?? {}),
        statuteReview: {
          reviewedBy,
          reviewedOn: input.reviewedOn,
          note: input.note?.trim() || undefined,
        },
      },
    });
    await repo.appendAdminEvent({
      id: crypto.randomUUID(),
      agencyId,
      kind: "statute_review_recorded",
      actorLabel: actor.name ?? actor.email,
      summary: `Statute profile sign-off recorded: ${reviewedBy}, ${input.reviewedOn}`,
      payload: { reviewedBy, reviewedOn: input.reviewedOn },
      createdAt: new Date(),
    });
    revalidatePath(`/${input.agencySlug}/app/admin`);
    return { ok: true };
  } catch (e) {
    console.error("recordStatuteReview failed", e);
    return { ok: false, error: "Could not record the sign-off." };
  }
}

/** Public request log toggle (opt-in transparency page at /[slug]/log). */
export async function setTransparencyLogAction(input: {
  agencySlug: string;
  enabled: boolean;
}): Promise<AdminResult> {
  try {
    const { actor, repo, agencyId } = await actorFor(input.agencySlug);
    const agency = await repo.getAgency(agencyId);
    await repo.updateAgency(agencyId, {
      settings: { ...(agency?.settings ?? {}), publicRequestLog: input.enabled },
    });
    await repo.appendAdminEvent({
      id: crypto.randomUUID(),
      agencyId,
      kind: "transparency_log_changed",
      actorLabel: actor.name ?? actor.email,
      summary: input.enabled
        ? "Public request log ENABLED — /log is now live"
        : "Public request log disabled",
      createdAt: new Date(),
    });
    revalidatePath(`/${input.agencySlug}/app/admin`);
    revalidatePath(`/${input.agencySlug}/log`);
    return { ok: true };
  } catch (e) {
    console.error("setTransparencyLog failed", e);
    return { ok: false, error: "Could not update the setting." };
  }
}

/**
 * Status API + webhook (agentic-horizon: the §16.4 first brick). The API
 * serves only the tracker's requester-safe projection; the webhook URL is
 * validated as an SSRF surface (checkWebhookUrl) because the server posts
 * to whatever a tenant admin types here.
 */
export async function setStatusApiAction(input: {
  agencySlug: string;
  enabled: boolean;
  webhookUrl: string;
}): Promise<AdminResult> {
  try {
    const { actor, repo, agencyId } = await actorFor(input.agencySlug);

    let webhookUrl: string | null = null;
    if (input.webhookUrl.trim()) {
      const { checkWebhookUrl } = await import("@/domain/statusApi");
      const checked = checkWebhookUrl(input.webhookUrl);
      if (!checked.ok) return { ok: false, error: checked.reason };
      webhookUrl = checked.url;
    }

    const agency = await repo.getAgency(agencyId);
    await repo.updateAgency(agencyId, {
      settings: {
        ...(agency?.settings ?? {}),
        statusApi: { enabled: input.enabled, webhookUrl },
      },
    });
    await repo.appendAdminEvent({
      id: crypto.randomUUID(),
      agencyId,
      kind: "status_api_changed",
      actorLabel: actor.name ?? actor.email,
      summary: input.enabled
        ? `Status API ENABLED${webhookUrl ? ` — webhook → ${webhookUrl}` : ""}`
        : "Status API disabled",
      payload: { enabled: input.enabled, webhookUrl },
      createdAt: new Date(),
    });
    revalidatePath(`/${input.agencySlug}/app/admin`);
    return { ok: true };
  } catch (e) {
    console.error("setStatusApi failed", e);
    return { ok: false, error: "Could not update the setting." };
  }
}

/**
 * Requester API + MCP server (docs/requester-api.md). Serves only
 * requester-safe projections of the public surface; filing is the one write
 * and gets its own toggle because a machine can file faster than a form.
 */
export async function setRequesterApiAction(input: {
  agencySlug: string;
  enabled: boolean;
  filingEnabled: boolean;
}): Promise<AdminResult> {
  try {
    const { actor, repo, agencyId } = await actorFor(input.agencySlug);

    const agency = await repo.getAgency(agencyId);
    await repo.updateAgency(agencyId, {
      settings: {
        ...(agency?.settings ?? {}),
        requesterApi: { enabled: input.enabled, filingEnabled: input.filingEnabled },
      },
    });
    await repo.appendAdminEvent({
      id: crypto.randomUUID(),
      agencyId,
      kind: "requester_api_changed",
      actorLabel: actor.name ?? actor.email,
      summary: input.enabled
        ? `Requester API ENABLED (filing ${input.filingEnabled ? "on" : "off"})`
        : "Requester API disabled",
      payload: { enabled: input.enabled, filingEnabled: input.filingEnabled },
      createdAt: new Date(),
    });
    revalidatePath(`/${input.agencySlug}/app/admin`);
    return { ok: true };
  } catch (e) {
    console.error("setRequesterApi failed", e);
    return { ok: false, error: "Could not update the setting." };
  }
}

/**
 * Public release verification (docs/release-verification.md): publishes
 * /[slug]/authenticity — invariant 8's checksums, projected. Read-only and
 * safe by construction (verification requires holding the exact bytes),
 * but the agency decides when to show the surface.
 */
export async function setReleaseVerificationAction(input: {
  agencySlug: string;
  enabled: boolean;
}): Promise<AdminResult> {
  try {
    const { actor, repo, agencyId } = await actorFor(input.agencySlug);

    const agency = await repo.getAgency(agencyId);
    await repo.updateAgency(agencyId, {
      settings: {
        ...(agency?.settings ?? {}),
        releaseVerification: { enabled: input.enabled },
      },
    });
    await repo.appendAdminEvent({
      id: crypto.randomUUID(),
      agencyId,
      kind: "release_verification_changed",
      actorLabel: actor.name ?? actor.email,
      summary: input.enabled
        ? "Release verification page ENABLED"
        : "Release verification page disabled",
      payload: { enabled: input.enabled },
      createdAt: new Date(),
    });
    revalidatePath(`/${input.agencySlug}/app/admin`);
    revalidatePath(`/${input.agencySlug}/authenticity`);
    return { ok: true };
  } catch (e) {
    console.error("setReleaseVerification failed", e);
    return { ok: false, error: "Could not update the setting." };
  }
}

/**
 * Network plays consent (docs/network-plays.md, invariant 11).
 *
 * This is the ONLY way an agency's history joins a cross-agency aggregate,
 * and the only way it leaves. Both directions are recorded in the
 * append-only admin log with the acting human's name, because "who agreed to
 * share this, and when" is the first question anyone will ask.
 *
 * Turning it OFF is meaningful, not cosmetic: the projection function refuses
 * to produce a contribution without consent, so the next weekly rebuild
 * excludes this agency entirely. Aggregates already computed are NOT
 * retracted — they were floor-cleared and non-attributable by construction —
 * and the panel copy says so rather than implying a retraction we cannot
 * perform.
 */
export async function setNetworkPlaysAction(input: {
  agencySlug: string;
  enabled: boolean;
}): Promise<AdminResult> {
  try {
    const { actor, repo, agencyId } = await actorFor(input.agencySlug);

    const agency = await repo.getAgency(agencyId);
    await repo.updateAgency(agencyId, {
      settings: {
        ...(agency?.settings ?? {}),
        networkPlays: { enabled: input.enabled },
      },
    });
    await repo.appendAdminEvent({
      id: crypto.randomUUID(),
      agencyId,
      kind: "network_consent_changed",
      actorLabel: actor.name ?? actor.email,
      summary: input.enabled
        ? "Network plays: consent GIVEN — this agency now contributes anonymized statistics to cross-agency aggregates"
        : "Network plays: consent WITHDRAWN — this agency is excluded from the next rebuild",
      payload: { enabled: input.enabled },
      createdAt: new Date(),
    });
    revalidatePath(`/${input.agencySlug}/app/admin`);
    return { ok: true };
  } catch (e) {
    console.error("setNetworkPlays failed", e);
    return { ok: false, error: "Could not update the setting." };
  }
}

/**
 * Fulfillment agent v1 (spec §16.1, opt-in — demo tenant first). Enables the
 * "Run fulfillment agent" button on request pages. The tier system is not a
 * setting: task dispatches always park at /app/agents (unless Tier-2 auto-send
 * is separately opted in), and release/denial/redaction stay human-only.
 */
export async function setFulfillmentAgentAction(input: {
  agencySlug: string;
  enabled: boolean;
}): Promise<AdminResult> {
  try {
    const { actor, repo, agencyId } = await actorFor(input.agencySlug);

    const agency = await repo.getAgency(agencyId);
    await repo.updateAgency(agencyId, {
      settings: {
        ...(agency?.settings ?? {}),
        fulfillmentAgent: { enabled: input.enabled },
      },
    });
    await repo.appendAdminEvent({
      id: crypto.randomUUID(),
      agencyId,
      kind: "fulfillment_agent_changed",
      actorLabel: actor.name ?? actor.email,
      summary: input.enabled ? "Fulfillment agent ENABLED" : "Fulfillment agent disabled",
      payload: { enabled: input.enabled },
      createdAt: new Date(),
    });
    revalidatePath(`/${input.agencySlug}/app/admin`);
    return { ok: true };
  } catch (e) {
    console.error("setFulfillmentAgent failed", e);
    return { ok: false, error: "Could not update the setting." };
  }
}
