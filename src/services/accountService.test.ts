import { describe, expect, it } from "vitest";
import { InMemoryRepository, type UserEntity } from "./repository";
import type { ServiceDeps } from "./deps";
import {
  AccountError,
  authenticateRequester,
  authenticateStaff,
  changeStaffRole,
  createStaffUser,
  registerRequester,
} from "./accountService";
import { submitRequest } from "./requestService";
import { hashPassword } from "@/auth/passwords";

const AG1 = "ag-1";
const AG2 = "ag-2";

function makeDeps(): ServiceDeps {
  let n = 0;
  const repo = new InMemoryRepository()
    .seedAgency({ id: AG1, slug: "riverton", name: "Riverton", stateCode: "CA", observedHolidays: [] })
    .seedAgency({ id: AG2, slug: "bellmar", name: "Bellmar", stateCode: "WA", observedHolidays: [] });
  return { repo, now: () => new Date("2026-07-28T12:00:00Z"), genId: () => `id-${++n}`, genToken: () => `tok-${n}` };
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

  it("claims prior email-deduped request history on registration", async () => {
    const deps = makeDeps();
    const filed = await submitRequest(deps, {
      agencyId: AG1,
      rawText: "council minutes",
      requester: { email: "wei@example.com", name: "Wei Chen" },
    });

    const account = await registerRequester(deps, { agencyId: AG1, email: "wei@example.com", name: "Wei", password: "longenough1" });
    expect(account.id).toBe(filed.requesterId); // same requester row → history claimed
    const mine = await deps.repo.listRequestsByRequester(AG1, account.id);
    expect(mine.map((r) => r.id)).toContain(filed.id);
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
