/**
 * Accounts — registration and sign-in for the two kinds of people in the
 * system (spec §3): **requesters** (residents; accounts optional, anonymity
 * preserved) and **staff** (agency officials; roster managed by agency admins).
 *
 * Everything is agency-scoped: the same email can hold accounts at two
 * different agencies — one app, many governments.
 */
import { hashPassword, passwordPolicyError, verifyPassword } from "@/auth/passwords";
import type { ServiceDeps } from "./deps";
import {
  NotFoundError,
  type Agency,
  type Requester,
  type RequesterType,
  type StaffRole,
  type UserEntity,
} from "./repository";

export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountError";
  }
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

// --- requesters ------------------------------------------------------------

/**
 * Register a resident account. If prior requests were filed under this email
 * (deduped requester row, no password), registration claims that history —
 * but the history stays HIDDEN until the email is verified: knowing someone's
 * address must never be enough to read what they requested. A fresh email
 * with nothing to claim is treated as verified immediately.
 *
 * When `verifyLinkBase` is provided and verification is needed, a one-time
 * link (`{verifyLinkBase}?token=...`) is delivered through the notifier.
 */
export async function registerRequester(
  deps: ServiceDeps,
  input: {
    agencyId: string;
    email: string;
    name: string;
    password: string;
    type?: RequesterType;
    verifyLinkBase?: string;
  },
): Promise<Requester> {
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) throw new AccountError("Enter a valid email address.");
  const policyError = passwordPolicyError(input.password);
  if (policyError) throw new AccountError(policyError);

  const existing = await deps.repo.findRequesterByEmail(input.agencyId, email);
  if (existing?.passwordHash) throw new AccountError("An account with this email already exists. Sign in instead.");

  const passwordHash = hashPassword(input.password);
  let requester: Requester;
  if (existing) {
    // Claiming a pre-account history → verification required before it shows.
    requester = await deps.repo.updateRequester(input.agencyId, existing.id, {
      passwordHash,
      name: existing.name ?? input.name,
      emailVerifiedAt: null,
    });
    if (input.verifyLinkBase) {
      const { mintToken } = await import("@/auth/tokens");
      const { raw } = await mintToken(deps, {
        agencyId: input.agencyId,
        kind: "verify_email",
        subjectId: requester.id,
      });
      await deps.notifier?.send({
        agencyId: input.agencyId,
        to: email,
        subject: "Verify your email to see your earlier requests",
        body: [
          `Welcome back. Requests were filed with this email before you created an account.`,
          `To see them in your account, verify that this address is yours:`,
          ``,
          `${input.verifyLinkBase}?token=${raw}`,
          ``,
          `The link expires in 48 hours. If this wasn't you, ignore this message.`,
        ].join("\n"),
        kind: "account_verify",
      });
    }
  } else {
    requester = await deps.repo.createRequester({
      id: deps.genId(),
      agencyId: input.agencyId,
      email,
      name: input.name.trim() || null,
      type: input.type ?? "individual",
      passwordHash,
      emailVerifiedAt: deps.now(), // nothing to claim — nothing to protect
    });
  }

  await deps.repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "requester_registered",
    actorLabel: "self-service",
    summary: `Resident account registered for ${email}${existing ? " (history pending verification)" : ""}`,
    createdAt: deps.now(),
  });
  return requester;
}

/**
 * Burn a verification token and unlock the claimed request history. The
 * agencyId is the tenant whose portal the link was opened on — a token minted
 * by another agency is rejected there (and left unburned).
 */
export async function verifyRequesterEmail(
  deps: ServiceDeps,
  agencyId: string,
  rawToken: string,
): Promise<Requester | null> {
  const { consumeToken } = await import("@/auth/tokens");
  const token = await consumeToken(deps, rawToken, "verify_email", agencyId);
  if (!token) return null;
  const requester = await deps.repo.updateRequester(token.agencyId, token.subjectId, {
    emailVerifiedAt: deps.now(),
  });
  await deps.repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: token.agencyId,
    kind: "email_verified",
    actorLabel: "self-service",
    summary: `Email verified for ${requester.email ?? requester.id}`,
    createdAt: deps.now(),
  });
  return requester;
}

export async function authenticateRequester(
  deps: ServiceDeps,
  input: { agencyId: string; email: string; password: string },
): Promise<Requester | null> {
  const requester = await deps.repo.findRequesterByEmail(input.agencyId, normalizeEmail(input.email));
  if (!requester || !verifyPassword(input.password, requester.passwordHash)) return null;
  return requester;
}

// --- staff -----------------------------------------------------------------

export async function authenticateStaff(
  deps: ServiceDeps,
  input: { agencyId: string; email: string; password: string },
): Promise<UserEntity | null> {
  const user = await deps.repo.findUserByEmail(input.agencyId, normalizeEmail(input.email));
  if (!user || !verifyPassword(input.password, user.passwordHash)) return null;
  return user;
}

/** Agency admin adds a staff member with an initial password and role. */
export async function createStaffUser(
  deps: ServiceDeps,
  input: {
    agencyId: string;
    actor: UserEntity; // must be an admin of the same agency
    email: string;
    name: string;
    role: StaffRole;
    password: string;
  },
): Promise<UserEntity> {
  assertAgencyAdmin(input.actor, input.agencyId);
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) throw new AccountError("Enter a valid email address.");
  const policyError = passwordPolicyError(input.password);
  if (policyError) throw new AccountError(policyError);
  if (await deps.repo.findUserByEmail(input.agencyId, email))
    throw new AccountError("A staff account with this email already exists.");

  const user = await deps.repo.createUser({
    id: deps.genId(),
    agencyId: input.agencyId,
    email,
    name: input.name.trim() || null,
    role: input.role,
    passwordHash: hashPassword(input.password),
  });
  await deps.repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "staff_created",
    actorLabel: input.actor.name ?? input.actor.email,
    summary: `Added ${user.name ?? user.email} as ${input.role}`,
    payload: { userId: user.id, role: input.role },
    createdAt: deps.now(),
  });
  return user;
}

/** Agency admin changes a colleague's role. Admins cannot demote themselves. */
export async function changeStaffRole(
  deps: ServiceDeps,
  input: { agencyId: string; actor: UserEntity; userId: string; role: StaffRole },
): Promise<UserEntity> {
  assertAgencyAdmin(input.actor, input.agencyId);
  if (input.actor.id === input.userId && input.role !== "admin")
    throw new AccountError("You can't remove your own admin role — ask another admin.");
  const user = await deps.repo.getUser(input.agencyId, input.userId);
  if (!user) throw new NotFoundError("User", input.userId);
  const updated = await deps.repo.updateUser(input.agencyId, input.userId, { role: input.role });
  await deps.repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "role_changed",
    actorLabel: input.actor.name ?? input.actor.email,
    summary: `Changed ${user.name ?? user.email}: ${user.role} → ${input.role}`,
    payload: { userId: user.id, from: user.role, to: input.role },
    createdAt: deps.now(),
  });
  return updated;
}

function assertAgencyAdmin(actor: UserEntity, agencyId: string): void {
  if (actor.agencyId !== agencyId || actor.role !== "admin")
    throw new AccountError("Only an agency admin can manage staff accounts.");
}

// --- self-service password reset + staff invites ---------------------------

/**
 * Start a reset. Deliberately silent about whether the account exists —
 * the response is identical either way; only a real account gets a link.
 */
export async function requestPasswordReset(
  deps: ServiceDeps,
  input: {
    agencyId: string;
    principal: "requester" | "staff";
    email: string;
    /** e.g. `${base}/${slug}/reset` — the token + kind are appended. */
    resetLinkBase: string;
  },
): Promise<void> {
  const email = normalizeEmail(input.email);
  const kind = input.principal === "staff" ? ("reset_staff" as const) : ("reset_requester" as const);
  const subjectId =
    input.principal === "staff"
      ? (await deps.repo.findUserByEmail(input.agencyId, email))?.id
      : (await deps.repo.findRequesterByEmail(input.agencyId, email))?.id;
  if (!subjectId) return; // same outward behavior as success

  const { mintToken } = await import("@/auth/tokens");
  const { raw } = await mintToken(deps, {
    agencyId: input.agencyId,
    kind,
    subjectId,
    ttlMs: 2 * 60 * 60 * 1000, // resets are short-lived: 2h
  });
  await deps.notifier?.send({
    agencyId: input.agencyId,
    to: email,
    subject: "Reset your password",
    body: [
      `Someone (hopefully you) asked to reset this account's password.`,
      ``,
      `${input.resetLinkBase}?token=${raw}&kind=${kind}`,
      ``,
      `The link works once and expires in 2 hours. If this wasn't you, ignore it.`,
    ].join("\n"),
    kind: "password_reset",
  });
}

/**
 * Burn a reset/invite token and set the new password. agencyId is the tenant
 * whose reset page was used; a token from another agency is rejected there.
 */
export async function completePasswordReset(
  deps: ServiceDeps,
  input: {
    agencyId: string;
    rawToken: string;
    kind: "reset_requester" | "reset_staff" | "staff_invite";
    password: string;
  },
): Promise<boolean> {
  const policyError = passwordPolicyError(input.password);
  if (policyError) throw new AccountError(policyError);

  const { consumeToken } = await import("@/auth/tokens");
  const token = await consumeToken(deps, input.rawToken, input.kind, input.agencyId);
  if (!token) return false;

  const passwordHash = hashPassword(input.password);
  let label: string;
  if (input.kind === "reset_requester") {
    const r = await deps.repo.updateRequester(token.agencyId, token.subjectId, { passwordHash });
    label = r.email ?? r.id;
  } else {
    const u = await deps.repo.updateUser(token.agencyId, token.subjectId, { passwordHash });
    label = u.email;
  }
  await deps.repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: token.agencyId,
    kind: input.kind === "staff_invite" ? "invite_accepted" : "password_reset",
    actorLabel: "self-service",
    summary:
      input.kind === "staff_invite"
        ? `Staff invite accepted by ${label}`
        : `Password reset completed for ${label}`,
    createdAt: deps.now(),
  });
  return true;
}

/**
 * Agency admin invites a staff member: account created with NO password; a
 * single-use invite link (7 days) lets them set their own. Nobody has to
 * hand credentials around.
 */
export async function inviteStaffUser(
  deps: ServiceDeps,
  input: {
    agencyId: string;
    actor: UserEntity;
    email: string;
    name: string;
    role: StaffRole;
    inviteLinkBase: string;
  },
): Promise<UserEntity> {
  assertAgencyAdmin(input.actor, input.agencyId);
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) throw new AccountError("Enter a valid email address.");
  if (await deps.repo.findUserByEmail(input.agencyId, email))
    throw new AccountError("A staff account with this email already exists.");

  const user = await deps.repo.createUser({
    id: deps.genId(),
    agencyId: input.agencyId,
    email,
    name: input.name.trim() || null,
    role: input.role,
    passwordHash: null, // cannot sign in until the invite is accepted
  });

  const { mintToken } = await import("@/auth/tokens");
  const { raw } = await mintToken(deps, {
    agencyId: input.agencyId,
    kind: "staff_invite",
    subjectId: user.id,
    ttlMs: 7 * 24 * 60 * 60 * 1000,
  });
  await deps.notifier?.send({
    agencyId: input.agencyId,
    to: email,
    subject: `You've been added to the records team`,
    body: [
      `${input.actor.name ?? input.actor.email} added you as ${input.role}.`,
      `Set your password to activate your account:`,
      ``,
      `${input.inviteLinkBase}?token=${raw}&kind=staff_invite`,
      ``,
      `The link works once and expires in 7 days.`,
    ].join("\n"),
    kind: "staff_invite",
  });
  await deps.repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "staff_invited",
    actorLabel: input.actor.name ?? input.actor.email,
    summary: `Invited ${user.name ?? email} as ${input.role}`,
    payload: { userId: user.id, role: input.role },
    createdAt: deps.now(),
  });
  return user;
}

// --- platform operator (cross-tenant; gated by requirePlatformAdmin above) --

/** Root URL segments a tenant slug may not shadow. */
const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "task",
  "login",
  "register",
  "account",
  "app",
  "signup",
]);

/**
 * Onboard a new government customer: create the agency, its first admin user,
 * and its ingestion-API source in one step. Platform-console only. The raw
 * ingest key is returned ONCE — only its hash is stored.
 */
export async function provisionAgency(
  deps: ServiceDeps,
  input: {
    name: string;
    slug: string;
    stateCode: string;
    admin: { name: string; email: string; password: string };
  },
): Promise<{ agency: Agency; admin: UserEntity; ingestKey: string }> {
  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(slug))
    throw new AccountError("Slug must be lowercase letters, digits, and dashes (e.g. 'riverton').");
  if (RESERVED_SLUGS.has(slug)) throw new AccountError(`"${slug}" is reserved — pick another slug.`);
  if (await deps.repo.getAgencyBySlug(slug)) throw new AccountError("That slug is already taken.");
  if (!input.name.trim()) throw new AccountError("Agency name is required.");
  const policyError = passwordPolicyError(input.admin.password);
  if (policyError) throw new AccountError(policyError);

  const agency = await deps.repo.createAgency({
    id: deps.genId(),
    slug,
    name: input.name.trim(),
    stateCode: input.stateCode.trim().toUpperCase(),
    observedHolidays: [],
  });
  const admin = await deps.repo.createUser({
    id: deps.genId(),
    agencyId: agency.id,
    email: normalizeEmail(input.admin.email),
    name: input.admin.name.trim() || null,
    role: "admin",
    passwordHash: hashPassword(input.admin.password),
  });

  // Ingestion-API credential: raw key surfaces exactly once, hash at rest.
  const { randomBytes, createHash } = await import("node:crypto");
  const ingestKey = `ck_${randomBytes(24).toString("base64url")}`;
  await deps.repo.createSource({
    id: deps.genId(),
    agencyId: agency.id,
    name: "Ingestion API",
    type: "api_push",
    apiKeyHash: createHash("sha256").update(ingestKey).digest("hex"),
    trust: "auto_publish",
    defaultClassification: "public",
  });

  await deps.repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: agency.id,
    kind: "agency_created",
    actorLabel: "platform operator",
    summary: `Agency provisioned with admin ${admin.email}`,
    payload: { slug: agency.slug, stateCode: agency.stateCode },
    createdAt: deps.now(),
  });
  return { agency, admin, ingestKey };
}

/** Platform console: reset any staff member's password. */
export async function resetStaffPassword(
  deps: ServiceDeps,
  input: { agencyId: string; userId: string; password: string; actorLabel?: string },
): Promise<UserEntity> {
  const policyError = passwordPolicyError(input.password);
  if (policyError) throw new AccountError(policyError);
  const user = await deps.repo.getUser(input.agencyId, input.userId);
  if (!user) throw new NotFoundError("User", input.userId);
  const updated = await deps.repo.updateUser(input.agencyId, input.userId, {
    passwordHash: hashPassword(input.password),
  });
  await deps.repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "password_reset",
    actorLabel: input.actorLabel ?? "platform operator",
    summary: `Password reset for ${user.name ?? user.email}`,
    payload: { userId: user.id },
    createdAt: deps.now(),
  });
  return updated;
}
