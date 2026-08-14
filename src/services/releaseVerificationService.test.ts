/**
 * Release verification service: verify answers tracker-level facts only and
 * stays tenant-scoped; the register resolves request public ids and carries
 * public releases only.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository, type Agency } from "./repository";
import { releaseRegister, verifyReleaseChecksum } from "./releaseVerificationService";

const SHA = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const AGENCY: Agency = { id: "ag-1", slug: "riverton", name: "Riverton", stateCode: "CA", observedHolidays: [] };
const OTHER: Agency = { id: "ag-2", slug: "bellmar", name: "Bellmar", stateCode: "CA", observedHolidays: [] };

async function seed() {
  const repo = new InMemoryRepository().seedAgency(AGENCY).seedAgency(OTHER);
  const request = await repo.createRequest({
    id: "req-1",
    agencyId: "ag-1",
    publicId: "PR-2026-00042",
    requesterId: null,
    status: "fulfilled",
    rawText: "inspection reports",
    interpretedScope: null,
    recordTypes: [],
    complexityScore: null,
    receivedAt: new Date("2026-05-01T00:00:00Z"),
    statutoryDueAt: null,
    closedAt: new Date("2026-06-01T00:00:00Z"),
    createdAt: new Date("2026-05-01T00:00:00Z"),
  });
  await repo.createRelease({
    id: "rel-1",
    agencyId: "ag-1",
    requestId: request.id,
    artifacts: [{ blobRef: "k", filename: "report.pdf", checksum: SHA, documentId: "doc-1" }],
    responseLetter: null,
    visibility: "public",
    approvedByUserId: "u-1",
    releasedAt: new Date("2026-06-01T00:00:00Z"),
  });
  return repo;
}

describe("verifyReleaseChecksum", () => {
  it("verifies a held file down to filename, date, and request", async () => {
    const repo = await seed();
    const result = await verifyReleaseChecksum(repo, { agencyId: "ag-1", hash: ` SHA256:${SHA.toUpperCase()} ` });
    expect(result).toEqual({
      verified: true,
      filename: "report.pdf",
      releasedAt: "2026-06-01T00:00:00.000Z",
      requestPublicId: "PR-2026-00042",
      visibility: "public",
    });
  });

  it("is tenant-scoped: the same hash means nothing to another agency", async () => {
    const repo = await seed();
    const result = await verifyReleaseChecksum(repo, { agencyId: "ag-2", hash: SHA });
    expect(result).toEqual({ verified: false, reason: "no_match" });
  });

  it("distinguishes malformed hashes from misses", async () => {
    const repo = await seed();
    expect(await verifyReleaseChecksum(repo, { agencyId: "ag-1", hash: "abc123" })).toEqual({
      verified: false,
      reason: "invalid_hash",
    });
  });
});

describe("releaseRegister", () => {
  it("serves public releases with request public ids; private ones never appear", async () => {
    const repo = await seed();
    await repo.createRelease({
      id: "rel-private",
      agencyId: "ag-1",
      requestId: "req-1",
      artifacts: [{ blobRef: "k2", filename: "private.pdf", checksum: SHA.replace("9", "a") }],
      responseLetter: null,
      visibility: "private",
      approvedByUserId: "u-1",
      releasedAt: new Date("2026-07-01T00:00:00Z"),
    });
    const rows = await releaseRegister(repo, "ag-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      releaseId: "rel-1",
      requestPublicId: "PR-2026-00042",
      artifacts: [{ filename: "report.pdf", sha256: SHA }],
    });
  });
});
