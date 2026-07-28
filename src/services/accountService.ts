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
 * (deduped requester row, no password), registration claims that history.
 */
export async function registerRequester(
  deps: ServiceDeps,
  input: { agencyId: string; email: string; name: string; password: string; type?: RequesterType },
): Promise<Requester> {
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) throw new AccountError("Enter a valid email address.");
  const policyError = passwordPolicyError(input.password);
  if (policyError) throw new AccountError(policyError);

  const existing = await deps.repo.findRequesterByEmail(input.agencyId, email);
  if (existing?.passwordHash) throw new AccountError("An account with this email already exists. Sign in instead.");

  const passwordHash = hashPassword(input.password);
  if (existing) {
    // Claim the pre-account request history.
    return deps.repo.updateRequester(input.agencyId, existing.id, {
      passwordHash,
      name: existing.name ?? input.name,
    });
  }
  return deps.repo.createRequester({
    id: deps.genId(),
    agencyId: input.agencyId,
    email,
    name: input.name.trim() || null,
    type: input.type ?? "individual",
    passwordHash,
  });
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

  return deps.repo.createUser({
    id: deps.genId(),
    agencyId: input.agencyId,
    email,
    name: input.name.trim() || null,
    role: input.role,
    passwordHash: hashPassword(input.password),
  });
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
  return deps.repo.updateUser(input.agencyId, input.userId, { role: input.role });
}

function assertAgencyAdmin(actor: UserEntity, agencyId: string): void {
  if (actor.agencyId !== agencyId || actor.role !== "admin")
    throw new AccountError("Only an agency admin can manage staff accounts.");
}

// --- platform operator (cross-tenant; gated by requirePlatformAdmin above) --

/** Root URL segments a tenant slug may not shadow. */
const RESERVED_SLUGS = new Set(["admin", "api", "task", "login", "register", "account", "app"]);

/**
 * Onboard a new government customer: create the agency and its first admin
 * user in one step. Platform-console only.
 */
export async function provisionAgency(
  deps: ServiceDeps,
  input: {
    name: string;
    slug: string;
    stateCode: string;
    admin: { name: string; email: string; password: string };
  },
): Promise<{ agency: Agency; admin: UserEntity }> {
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
  return { agency, admin };
}

/** Platform console: reset any staff member's password. */
export async function resetStaffPassword(
  deps: ServiceDeps,
  input: { agencyId: string; userId: string; password: string },
): Promise<UserEntity> {
  const policyError = passwordPolicyError(input.password);
  if (policyError) throw new AccountError(policyError);
  const user = await deps.repo.getUser(input.agencyId, input.userId);
  if (!user) throw new NotFoundError("User", input.userId);
  return deps.repo.updateUser(input.agencyId, input.userId, { passwordHash: hashPassword(input.password) });
}
