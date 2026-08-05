/**
 * Department-scoped accounts: the user↔department membership that drives a
 * responder's task view. Tenancy rules hold here like everywhere else.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository, NotFoundError, type Agency, type UserEntity } from "./repository";

const RIVERTON: Agency = { id: "ag-1", slug: "riverton", name: "City of Riverton", stateCode: "CA", observedHolidays: [] };
const BELLMAR: Agency = { id: "ag-2", slug: "bellmar", name: "City of Bellmar", stateCode: "WA", observedHolidays: [] };

const SAM: UserEntity = { id: "u-sam", agencyId: "ag-1", email: "sam@riverton.gov", name: "Sam", role: "responder", passwordHash: null };

async function ctx() {
  const repo = new InMemoryRepository().seedAgency(RIVERTON).seedAgency(BELLMAR);
  await repo.createUser(SAM);
  repo.seedDepartment({ id: "d-pw", agencyId: "ag-1", name: "Public Works", defaultResponderEmails: [] });
  repo.seedDepartment({ id: "d-pd", agencyId: "ag-1", name: "Police Records", defaultResponderEmails: [] });
  repo.seedDepartment({ id: "d-bell", agencyId: "ag-2", name: "Parks", defaultResponderEmails: [] });
  return repo;
}

describe("user↔department membership", () => {
  it("round-trips: set, list, replace", async () => {
    const repo = await ctx();
    await repo.setUserDepartments("ag-1", "u-sam", ["d-pw"]);
    expect(await repo.listUserDepartmentIds("ag-1", "u-sam")).toEqual(["d-pw"]);

    // Replacement, not accumulation — the admin's checkbox state is the truth.
    await repo.setUserDepartments("ag-1", "u-sam", ["d-pd"]);
    expect(await repo.listUserDepartmentIds("ag-1", "u-sam")).toEqual(["d-pd"]);

    await repo.setUserDepartments("ag-1", "u-sam", []);
    expect(await repo.listUserDepartmentIds("ag-1", "u-sam")).toEqual([]);
  });

  it("silently drops another tenant's department ids — they can never attach", async () => {
    const repo = await ctx();
    await repo.setUserDepartments("ag-1", "u-sam", ["d-pw", "d-bell"]);
    expect(await repo.listUserDepartmentIds("ag-1", "u-sam")).toEqual(["d-pw"]);
  });

  it("refuses to set memberships through the wrong tenant, and lists nothing", async () => {
    const repo = await ctx();
    await repo.setUserDepartments("ag-1", "u-sam", ["d-pw"]);
    await expect(repo.setUserDepartments("ag-2", "u-sam", ["d-bell"])).rejects.toThrow(NotFoundError);
    expect(await repo.listUserDepartmentIds("ag-2", "u-sam")).toEqual([]); // tenant isolation
  });
});
