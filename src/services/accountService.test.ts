import { describe, expect, it } from "vitest";
import { InMemoryRepository, type UserEntity } from "./repository";
import type { ServiceDeps } from "./deps";
import {
  AccountError,
  authenticateRequester,
  authenticateStaff,
  changeStaffRole,
  completePasswordReset,
  createStaffUser,
  inviteStaffUser,
  platformCreateStaffUser,
  platformInviteStaffUser,
  provisionAgency,
  registerRequester,
  renameAgency,
  requestPasswordReset,
  resendStaffInvite,
  revokeStaffSignIn,
  verifyRequesterEmail,
} from "./accountService";
import { submitRequest } from "./requestService";
import { hashPassword } from "@/auth/passwords";
import { CollectingNotifier } from "./notifications";

const AG1 = "ag-1";
const AG2 = "ag-2";

function makeDeps(): ServiceDeps & { notifier: CollectingNotifier } {
  let n = 0;
  const repo = new InMemoryRepository()
    .seedAgency({ id: AG1, slug: "riverton", name: "Riverton", stateCode: "CA", observedHolidays: [] })
    .seedAgency({ id: AG2, slug: "bellmar", name: "Bellmar", stateCode: "WA", observedHolidays: [] });
  return {
    repo,
    now: () => new Date("2026-07-28T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
    notifier: new CollectingNotifier(),
  };
}

/** Pull the one-time link's raw token out of a delivered message body. */
function tokenFromBody(body: string): string {
  const m = body.match(/[?&]token=([^\s&]+)/);
  if (!m) throw new Error(`no token in body:\n${body}`);
  return m[1]!;
}

async function makeAdmin(deps: ServiceDeps, agencyId: string): Promise<UserEntity> {
  return deps.repo.createUser({
    id: deps.genId(),
    agencyId,
    email: "admin@ag.gov",
    name: "Admin",
    role: "admin",
    passwordHash: hashPassword("admin-pass-1"),
  });
}

describe("requester accounts", () => {
  it("registers, then signs in with the right password only", async () => {
    const deps = makeDeps();
    await registerRequester(deps, { agencyId: AG1, email: "Sam@Example.com", name: "Sam", password: "hunter2222" });

    expect(await authenticateRequester(deps, { agencyId: AG1, email: "sam@example.com", password: "hunter2222" })).not.toBeNull();
    expect(await authenticateRequester(deps, { agencyId: AG1, email: "sam@example.com", password: "wrong-pass" })).toBeNull();
    // Accounts are agency-scoped: same email at another agency is a different (absent) account.
    expect(await authenticateRequester(deps, { agencyId: AG2, email: "sam@example.com", password: "hunter2222" })).toBeNull();
  });

  it("claims prior history on registration, but locks it behind email verification", async () => {
    const deps = makeDeps();
    const filed = await submitRequest(deps, {
      agencyId: AG1,
      rawText: "council minutes",
      requester: { email: "wei@example.com", name: "Wei Chen" },
    });

    const account = await registerRequester(deps, {
      agencyId: AG1,
      email: "wei@example.com",
      name: "Wei",
      password: "longenough1",
      verifyLinkBase: "http://x/riverton/verify",
    });
    expect(account.id).toBe(filed.requesterId); // same requester row → history claimed
    // The claim is NOT trusted yet — knowing an email must not expose history.
    expect(account.emailVerifiedAt).toBeNull();

    // The verification link went out; burning it unlocks the history.
    const mail = deps.notifier.sent.find((m) => m.kind === "account_verify");
    expect(mail?.to).toBe("wei@example.com");
    // Another tenant's portal cannot redeem it — and doesn't burn it.
    expect(await verifyRequesterEmail(deps, AG2, tokenFromBody(mail!.body))).toBeNull();

    const verified = await verifyRequesterEmail(deps, AG1, tokenFromBody(mail!.body));
    expect(verified?.emailVerifiedAt).not.toBeNull();

    // Tokens are single-use.
    expect(await verifyRequesterEmail(deps, AG1, tokenFromBody(mail!.body))).toBeNull();

    const mine = await deps.repo.listRequestsByRequester(AG1, account.id);
    expect(mine.map((r) => r.id)).toContain(filed.id);
  });

  it("fresh registrations (nothing to claim) are verified immediately", async () => {
    const deps = makeDeps();
    const account = await registerRequester(deps, {
      agencyId: AG1,
      email: "new@example.com",
      name: "New",
      password: "longenough1",
      verifyLinkBase: "http://x/riverton/verify",
    });
    expect(account.emailVerifiedAt).not.toBeNull();
    expect(deps.notifier.sent.filter((m) => m.kind === "account_verify")).toHaveLength(0);
  });

  it("rejects duplicate registration and weak passwords", async () => {
    const deps = makeDeps();
    await registerRequester(deps, { agencyId: AG1, email: "a@b.com", name: "A", password: "longenough1" });
    await expect(
      registerRequester(deps, { agencyId: AG1, email: "a@b.com", name: "A", password: "longenough1" }),
    ).rejects.toBeInstanceOf(AccountError);
    await expect(
      registerRequester(deps, { agencyId: AG1, email: "c@d.com", name: "C", password: "short" }),
    ).rejects.toBeInstanceOf(AccountError);
  });
});

describe("staff accounts", () => {
  it("admin creates staff; staff can sign in; tenant isolation holds", async () => {
    const deps = makeDeps();
    const admin = await makeAdmin(deps, AG1);
    const user = await createStaffUser(deps, {
      agencyId: AG1,
      actor: admin,
      email: "clerk@riverton.gov",
      name: "Pat",
      role: "coordinator",
      password: "staff-pass-1",
    });
    expect(user.role).toBe("coordinator");

    expect(await authenticateStaff(deps, { agencyId: AG1, email: "clerk@riverton.gov", password: "staff-pass-1" })).not.toBeNull();
    expect(await authenticateStaff(deps, { agencyId: AG1, email: "clerk@riverton.gov", password: "nope" })).toBeNull();
    expect(await authenticateStaff(deps, { agencyId: AG2, email: "clerk@riverton.gov", password: "staff-pass-1" })).toBeNull();
  });

  it("only same-agency admins can manage the roster", async () => {
    const deps = makeDeps();
    const admin = await makeAdmin(deps, AG1);
    const coordinator = await createStaffUser(deps, {
      agencyId: AG1,
      actor: admin,
      email: "c@riverton.gov",
      name: "C",
      role: "coordinator",
      password: "staff-pass-1",
    });

    // A coordinator cannot create users.
    await expect(
      createStaffUser(deps, {
        agencyId: AG1,
        actor: coordinator,
        email: "x@riverton.gov",
        name: "X",
        role: "reviewer",
        password: "staff-pass-1",
      }),
    ).rejects.toBeInstanceOf(AccountError);

    // An admin of another agency cannot manage this one.
    await expect(
      createStaffUser(deps, {
        agencyId: AG2,
        actor: admin,
        email: "x@bellmar.gov",
        name: "X",
        role: "reviewer",
        password: "staff-pass-1",
      }),
    ).rejects.toBeInstanceOf(AccountError);
  });

  it("resets passwords via one-time link without leaking account existence", async () => {
    const deps = makeDeps();
    const admin = await makeAdmin(deps, AG1);
    await createStaffUser(deps, {
      agencyId: AG1,
      actor: admin,
      email: "c@riverton.gov",
      name: "C",
      role: "coordinator",
      password: "old-pass-111",
    });

    // Unknown email: same outward behavior, no mail.
    await requestPasswordReset(deps, {
      agencyId: AG1,
      principal: "staff",
      email: "nobody@riverton.gov",
      resetLinkBase: "http://x/riverton/reset",
    });
    expect(deps.notifier.sent.filter((m) => m.kind === "password_reset")).toHaveLength(0);

    await requestPasswordReset(deps, {
      agencyId: AG1,
      principal: "staff",
      email: "c@riverton.gov",
      resetLinkBase: "http://x/riverton/reset",
    });
    const mail = deps.notifier.sent.find((m) => m.kind === "password_reset")!;
    // A reset link is bound to the tenant that minted it: another agency's
    // reset page rejects it without burning it.
    expect(
      await completePasswordReset(deps, {
        agencyId: AG2,
        rawToken: tokenFromBody(mail.body),
        kind: "reset_staff",
        password: "brand-new-pass1",
      }),
    ).toBe(false);
    const ok = await completePasswordReset(deps, {
      agencyId: AG1,
      rawToken: tokenFromBody(mail.body),
      kind: "reset_staff",
      password: "brand-new-pass1",
    });
    expect(ok).toBe(true);
    expect(await authenticateStaff(deps, { agencyId: AG1, email: "c@riverton.gov", password: "brand-new-pass1" })).not.toBeNull();
    expect(await authenticateStaff(deps, { agencyId: AG1, email: "c@riverton.gov", password: "old-pass-111" })).toBeNull();
  });

  it("invites staff without a password; the invite link activates the account", async () => {
    const deps = makeDeps();
    const admin = await makeAdmin(deps, AG1);
    const invited = await inviteStaffUser(deps, {
      agencyId: AG1,
      actor: admin,
      email: "new@riverton.gov",
      name: "Newcomer",
      role: "reviewer",
      inviteLinkBase: "http://x/riverton/reset",
    });
    expect(invited.passwordHash).toBeNull(); // cannot sign in yet
    expect(await authenticateStaff(deps, { agencyId: AG1, email: "new@riverton.gov", password: "anything-here" })).toBeNull();

    const mail = deps.notifier.sent.find((m) => m.kind === "staff_invite")!;
    const ok = await completePasswordReset(deps, {
      agencyId: AG1,
      rawToken: tokenFromBody(mail.body),
      kind: "staff_invite",
      password: "my-own-pass-1",
    });
    expect(ok).toBe(true);
    expect(await authenticateStaff(deps, { agencyId: AG1, email: "new@riverton.gov", password: "my-own-pass-1" })).not.toBeNull();
  });

  it("changes roles but blocks self-demotion", async () => {
    const deps = makeDeps();
    const admin = await makeAdmin(deps, AG1);
    const user = await createStaffUser(deps, {
      agencyId: AG1,
      actor: admin,
      email: "c@riverton.gov",
      name: "C",
      role: "coordinator",
      password: "staff-pass-1",
    });

    const promoted = await changeStaffRole(deps, { agencyId: AG1, actor: admin, userId: user.id, role: "admin" });
    expect(promoted.role).toBe("admin");

    await expect(
      changeStaffRole(deps, { agencyId: AG1, actor: admin, userId: admin.id, role: "read_only" }),
    ).rejects.toBeInstanceOf(AccountError);
  });
});

describe("provisionAgency — the multi-tenant front door (self-signup + console)", () => {
  it("creates an isolated tenant: agency, admin, one-time ingest key", async () => {
    const deps = makeDeps();
    const { agency, admin, ingestKey } = await provisionAgency(deps, {
      name: "City of Marlin",
      slug: "Marlin", // case-normalized
      stateCode: "ca",
      admin: { name: "Rae Ortiz", email: "Rae@Marlin.gov", password: "marlin-pass-1" },
    });

    expect(agency.slug).toBe("marlin");
    expect(agency.stateCode).toBe("CA");
    expect(admin.role).toBe("admin");
    expect(ingestKey).toMatch(/^ck_/);

    // Tenant isolation from row one: the new admin exists only in the new tenant.
    expect(await deps.repo.findUserByEmail(agency.id, "rae@marlin.gov")).not.toBeNull();
    expect(await deps.repo.findUserByEmail(AG1, "rae@marlin.gov")).toBeNull();
    // The raw key is never stored — only its hash resolves it.
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(ingestKey).digest("hex");
    expect(await deps.repo.findSourceByApiKeyHash(agency.id, hash)).not.toBeNull();
    expect(await deps.repo.findSourceByApiKeyHash(agency.id, ingestKey)).toBeNull();
  });

  it("refuses reserved slugs — including /signup itself", async () => {
    const deps = makeDeps();
    for (const slug of ["signup", "admin", "api", "app"]) {
      await expect(
        provisionAgency(deps, {
          name: "X",
          slug,
          stateCode: "CA",
          admin: { name: "A", email: "a@x.gov", password: "password-11" },
        }),
      ).rejects.toThrow(AccountError);
    }
  });

  it("refuses a taken slug and malformed slugs", async () => {
    const deps = makeDeps();
    await expect(
      provisionAgency(deps, {
        name: "Riverton Again",
        slug: "riverton",
        stateCode: "CA",
        admin: { name: "A", email: "a@x.gov", password: "password-11" },
      }),
    ).rejects.toThrow(/already taken/);
    await expect(
      provisionAgency(deps, {
        name: "Bad",
        slug: "Has Spaces!",
        stateCode: "CA",
        admin: { name: "A", email: "a@x.gov", password: "password-11" },
      }),
    ).rejects.toThrow(AccountError);
  });
});

describe("platform console — city & user management", () => {
  it("renames an agency's display name only, with an audit event; slug/state fixed", async () => {
    const deps = makeDeps();
    const renamed = await renameAgency(deps, { agencyId: AG1, name: "  City of Riverton  " });
    expect(renamed.name).toBe("City of Riverton");
    expect(renamed.slug).toBe("riverton");
    expect(renamed.stateCode).toBe("CA");

    const events = await deps.repo.listAdminEvents(AG1);
    const ev = events.find((e) => e.kind === "agency_renamed");
    expect(ev?.actorLabel).toBe("platform operator");
    expect(ev?.summary).toContain('"Riverton" → "City of Riverton"');

    await expect(renameAgency(deps, { agencyId: AG1, name: "   " })).rejects.toThrow(AccountError);
    // A no-op rename appends nothing.
    await renameAgency(deps, { agencyId: AG1, name: "City of Riverton" });
    expect((await deps.repo.listAdminEvents(AG1)).filter((e) => e.kind === "agency_renamed")).toHaveLength(1);
  });

  it("adds staff to any tenant without a tenant actor, attributed to the operator", async () => {
    const deps = makeDeps();
    const created = await platformCreateStaffUser(deps, {
      agencyId: AG1,
      email: "Pat@Riverton.gov",
      name: "Pat",
      role: "coordinator",
      password: "pat-pass-123",
    });
    expect(created.email).toBe("pat@riverton.gov");
    expect(
      await authenticateStaff(deps, { agencyId: AG1, email: "pat@riverton.gov", password: "pat-pass-123" }),
    ).not.toBeNull();
    // Tenant isolation: the account exists only where it was created.
    expect(await deps.repo.findUserByEmail(AG2, "pat@riverton.gov")).toBeNull();

    const ev = (await deps.repo.listAdminEvents(AG1)).find((e) => e.kind === "staff_created");
    expect(ev?.actorLabel).toBe("platform operator");

    // Same validation as the tenant path: dup emails and weak passwords refuse.
    await expect(
      platformCreateStaffUser(deps, { agencyId: AG1, email: "pat@riverton.gov", name: "P", role: "reviewer", password: "another-pass-1" }),
    ).rejects.toThrow(/already exists/);
    await expect(
      platformCreateStaffUser(deps, { agencyId: AG1, email: "q@riverton.gov", name: "Q", role: "reviewer", password: "short" }),
    ).rejects.toThrow(AccountError);
  });

  it("invites staff from the console; the link activates the account; re-send works until activation", async () => {
    const deps = makeDeps();
    const invited = await platformInviteStaffUser(deps, {
      agencyId: AG1,
      email: "lee@riverton.gov",
      name: "Lee",
      role: "responder",
      inviteLinkBase: "http://x/riverton/reset",
    });
    expect(invited.passwordHash).toBeNull();
    expect(deps.notifier.sent).toHaveLength(1);
    expect(deps.notifier.sent[0]!.body).toContain("platform operator added you as responder");

    // Re-send mints a fresh link and logs it.
    await resendStaffInvite(deps, { agencyId: AG1, userId: invited.id, inviteLinkBase: "http://x/riverton/reset" });
    expect(deps.notifier.sent).toHaveLength(2);
    expect(
      (await deps.repo.listAdminEvents(AG1)).find((e) => e.summary.includes("Invite re-sent")),
    ).toBeTruthy();

    // The newest link activates the account.
    const token = tokenFromBody(deps.notifier.sent[1]!.body);
    expect(
      await completePasswordReset(deps, { agencyId: AG1, rawToken: token, kind: "staff_invite", password: "lee-pass-1234" }),
    ).toBe(true);
    expect(
      await authenticateStaff(deps, { agencyId: AG1, email: "lee@riverton.gov", password: "lee-pass-1234" }),
    ).not.toBeNull();

    // Once activated, re-sending an invite is refused — that's a reset now.
    await expect(
      resendStaffInvite(deps, { agencyId: AG1, userId: invited.id, inviteLinkBase: "http://x/riverton/reset" }),
    ).rejects.toThrow(/already activated/);
  });

  it("revokes sign-in by clearing the password, but never orphans a tenant's last admin", async () => {
    const deps = makeDeps();
    const admin = await makeAdmin(deps, AG1);
    const reviewer = await platformCreateStaffUser(deps, {
      agencyId: AG1,
      email: "rev@riverton.gov",
      name: "Rev",
      role: "reviewer",
      password: "rev-pass-1234",
    });

    // The only signable admin is protected.
    await expect(revokeStaffSignIn(deps, { agencyId: AG1, userId: admin.id })).rejects.toThrow(/only admin/);

    // Non-admins revoke fine; the row survives, sign-in dies.
    const revoked = await revokeStaffSignIn(deps, { agencyId: AG1, userId: reviewer.id });
    expect(revoked.passwordHash).toBeNull();
    expect(
      await authenticateStaff(deps, { agencyId: AG1, email: "rev@riverton.gov", password: "rev-pass-1234" }),
    ).toBeNull();
    expect((await deps.repo.listAdminEvents(AG1)).find((e) => e.kind === "signin_revoked")).toBeTruthy();

    // With a second signable admin in place, the first can be revoked.
    await platformCreateStaffUser(deps, {
      agencyId: AG1,
      email: "admin2@riverton.gov",
      name: "Admin Two",
      role: "admin",
      password: "admin2-pass-1",
    });
    expect((await revokeStaffSignIn(deps, { agencyId: AG1, userId: admin.id })).passwordHash).toBeNull();

    // Nothing to revoke twice.
    await expect(revokeStaffSignIn(deps, { agencyId: AG1, userId: reviewer.id })).rejects.toThrow(/never activated/);
  });
});
