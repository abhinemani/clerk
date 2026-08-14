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
    expect(result.imported).toEqual([{ publicId: "PR-2024-00001", legacyId: "OLD-1", linkedDocuments: 0 }]);
    expect(result.failed).toEqual([]);
    expect(result.releasesCreated).toBe(0);

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

describe("importLegacyRequests — release-history linkage", () => {
  const HEADER_R = `${HEADER},released_records`;

  async function docOf(repo: InMemoryRepository, externalId: string, classification: "public" | "internal") {
    return repo.createDocument({
      id: crypto.randomUUID(),
      agencyId: "ag-1",
      sourceId: null,
      externalSystemId: externalId,
      filename: `${externalId}.pdf`,
      classification,
      recordType: null,
      processingStatus: "ready",
      metadata: {},
      blobRef: `blob/${externalId}`,
      checksum: `cs-${externalId}`,
      createdAt: new Date("2024-01-01T00:00:00Z"),
    });
  }

  it("links named records as a release: request_documents rows, artifacts, askedAs, backlink", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(ADMIN);
    const d1 = await docOf(repo, "PAV-001", "public");
    const d2 = await docOf(repo, "PAV-002", "public");
    const csv = [
      HEADER_R,
      '"OLD-9",Jane,jane@example.com,"All emails re: Main St paving, Jan-Mar 2024",fulfilled,2024-01-15,,2024-01-24,,,"PAV-001;PAV-002"',
    ].join("\n");
    const { rows } = parseLegacyCsv(csv);
    const result = await importLegacyRequests(deps, { agencyId: "ag-1", actorUserId: "u-dana", rows });

    expect(result.releasesCreated).toBe(1);
    expect(result.documentsLinked).toBe(2);
    expect(result.missingRecordIds).toEqual([]);
    expect(result.imported[0]!.linkedDocuments).toBe(2);

    const request = (await repo.listRequests("ag-1"))[0]!;
    // The docs joined the request's review set.
    const linked = await repo.listRequestDocuments("ag-1", request.id);
    expect(linked.map((d) => d.id).sort()).toEqual([d1.id, d2.id].sort());

    // A real release row, dated to the historical closure, approved by the importer.
    const releases = await repo.listReleases("ag-1", request.id);
    expect(releases).toHaveLength(1);
    const release = releases[0]!;
    expect(release.visibility).toBe("public"); // every linked doc was ALREADY public
    expect(release.approvedByUserId).toBe("u-dana");
    expect(release.releasedAt.toISOString().slice(0, 10)).toBe("2024-01-24");
    expect(release.artifacts.map((a) => a.documentId).sort()).toEqual([d1.id, d2.id].sort());

    // The ask-alias loop + archive backlink landed on the docs.
    const doc = await repo.getDocument("ag-1", d1.id);
    expect((doc!.metadata as { askedAs?: string[] }).askedAs).toContain(
      "All emails re: Main St paving, Jan-Mar 2024",
    );
    expect((doc!.metadata as { releaseId?: string }).releaseId).toBe(release.id);

    // Still one event per row — enriched, not multiplied.
    const events = await repo.listEvents("ag-1", request.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.summary).toContain("2 released document(s) linked");
    expect(events[0]!.payload?.releaseId).toBe(release.id);
  });

  it("an internal doc anywhere in the set makes the release PRIVATE — publicness is never minted here", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(ADMIN);
    await docOf(repo, "A-1", "public");
    const internal = await docOf(repo, "A-2", "internal");
    const csv = [HEADER_R, ',,,"Mixed release",fulfilled,2024-02-01,,2024-02-10,,,"A-1;A-2"'].join("\n");
    const { rows } = parseLegacyCsv(csv);
    await importLegacyRequests(deps, { agencyId: "ag-1", actorUserId: "u-dana", rows });

    const request = (await repo.listRequests("ag-1"))[0]!;
    const release = (await repo.listReleases("ag-1", request.id))[0]!;
    expect(release.visibility).toBe("private");
    // And the internal doc STAYS internal — invariant 9 untouched.
    expect((await repo.getDocument("ag-1", internal.id))!.classification).toBe("internal");
  });

  it("unknown external ids are reported, matched ones still link, the row still imports", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(ADMIN);
    await docOf(repo, "REAL-1", "internal");
    const csv = [HEADER_R, ',,,"Partial match",fulfilled,2024-03-01,,,,,"REAL-1;GHOST-9"'].join("\n");
    const { rows } = parseLegacyCsv(csv);
    const result = await importLegacyRequests(deps, { agencyId: "ag-1", actorUserId: "u-dana", rows });

    expect(result.releasesCreated).toBe(1);
    expect(result.documentsLinked).toBe(1);
    expect(result.missingRecordIds).toEqual(["GHOST-9"]);
    const request = (await repo.listRequests("ag-1"))[0]!;
    const events = await repo.listEvents("ag-1", request.id);
    expect(events[0]!.payload?.missingReleasedRecordIds).toEqual(["GHOST-9"]);
  });

  it("rows without the column behave exactly as before — no releases, no doc reads", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(ADMIN);
    const csv = [HEADER, ',,,"Plain history",fulfilled,2024-04-01,,,,'].join("\n");
    const { rows } = parseLegacyCsv(csv);
    const result = await importLegacyRequests(deps, { agencyId: "ag-1", actorUserId: "u-dana", rows });
    expect(result.releasesCreated).toBe(0);
    const request = (await repo.listRequests("ag-1"))[0]!;
    expect(await repo.listReleases("ag-1", request.id)).toEqual([]);
  });
});
