/**
 * Legacy import service tests: real requests land in the repo with their
 * historical status/dates (no live-workflow side effects), requesters
 * dedupe by email, and one bad row never sinks the batch.
 */
import { describe, expect, it } from "vitest";
import { parseLegacyCsv } from "@/domain/legacyImport";
import { InMemoryRepository, type Agency, type UserEntity } from "./repository";
import type { ServiceDeps } from "./deps";
import { importLegacyRequests } from "./legacyImportService";

const AGENCY: Agency = { id: "ag-1", slug: "riverton", name: "Riverton", stateCode: "CA", observedHolidays: [] };
const ADMIN: UserEntity = { id: "u-dana", agencyId: "ag-1", email: "dana@riverton.gov", name: "Dana", role: "admin", passwordHash: null };

const HEADER =
  "legacy_id,requester_name,requester_email,description,status,filed_date,due_date,closed_date,department,record_type";

function ctx() {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-07-31T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
  };
  return { repo, deps };
}

describe("importLegacyRequests", () => {
  it("creates requests with their ORIGINAL historical status and dates, no live side effects", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(ADMIN);
    const csv = [
      HEADER,
      '"OLD-1",Jane Reyes,jane@example.com,"Sidewalk repair records",fulfilled,2024-01-15,2024-01-25,2024-01-24,Public Works,contract',
    ].join("\n");
    const { rows } = parseLegacyCsv(csv);

    const result = await importLegacyRequests(deps, { agencyId: "ag-1", actorUserId: "u-dana", rows });
    expect(result.imported).toEqual([{ publicId: "PR-2024-00001", legacyId: "OLD-1" }]);
    expect(result.failed).toEqual([]);

    const requests = await repo.listRequests("ag-1");
    expect(requests).toHaveLength(1);
    const r = requests[0]!;
    expect(r.status).toBe("fulfilled"); // straight to terminal — no state-machine walk
    expect(r.receivedAt?.toISOString().slice(0, 10)).toBe("2024-01-15");
    expect(r.closedAt?.toISOString().slice(0, 10)).toBe("2024-01-24");
    expect(r.recordTypes).toEqual(["contract"]);

    const events = await repo.listEvents("ag-1", r.id);
    expect(events).toHaveLength(1); // exactly one note — no status_change/ai_action/delivery noise
    expect(events[0]!.kind).toBe("note");
    expect(events[0]!.actorUserId).toBe("u-dana");
    expect(events[0]!.summary).toContain("Imported from legacy system by Dana");
    expect(events[0]!.summary).toContain("OLD-1");
    expect(events[0]!.payload?.source).toBe("legacy_import");
  });

  it("dedupes requesters by email, within the batch and against existing records", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(ADMIN);
    await repo.createRequester({ id: "req-existing", agencyId: "ag-1", email: "jane@example.com", name: "Jane R.", type: "individual" });
    const csv = [
      HEADER,
      '1,Jane Reyes,jane@example.com,"First",new,2024-01-01,,,,',
      '2,Jane Reyes,jane@example.com,"Second",new,2024-02-01,,,,',
    ].join("\n");
    const { rows } = parseLegacyCsv(csv);
    await importLegacyRequests(deps, { agencyId: "ag-1", actorUserId: "u-dana", rows });

    const requesters = await repo.listRequesters("ag-1");
    expect(requesters).toHaveLength(1); // no duplicate created
    const requests = await repo.listRequests("ag-1");
    expect(requests.every((r) => r.requesterId === "req-existing")).toBe(true);
  });

  it("assigns sequential public ids per the row's OWN year, not the import date", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(ADMIN);
    const csv = [HEADER, '1,,,"A",new,2019-06-01,,,,', '2,,,"B",new,2019-06-02,,,,', '3,,,"C",new,2024-01-01,,,,'].join("\n");
    const { rows } = parseLegacyCsv(csv);
    const result = await importLegacyRequests(deps, { agencyId: "ag-1", actorUserId: "u-dana", rows });
    expect(result.imported.map((r) => r.publicId)).toEqual(["PR-2019-00001", "PR-2019-00002", "PR-2024-00001"]);
  });

  it("keeps anonymous rows anonymous (no email or name)", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(ADMIN);
    const csv = [HEADER, ',,,"anon request",new,2024-01-01,,,,'].join("\n");
    const { rows } = parseLegacyCsv(csv);
    await importLegacyRequests(deps, { agencyId: "ag-1", actorUserId: "u-dana", rows });
    const requests = await repo.listRequests("ag-1");
    expect(requests[0]!.requesterId).toBeNull();
    expect(await repo.listRequesters("ag-1")).toHaveLength(0);
  });
});
