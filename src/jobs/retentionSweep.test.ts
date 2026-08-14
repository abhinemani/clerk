/**
 * Agency-wide retention sweep — warnings land in the append-only admin log,
 * quiet agencies stay quiet, held documents never alarm.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository, type DocumentEntity } from "@/services/repository";
import { runRetentionSweep } from "./retentionSweep";

const AG = "aaaaaaaa-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-13T12:00:00Z");
const uid = () => crypto.randomUUID();

function docOf(over: Partial<DocumentEntity> = {}): DocumentEntity {
  return {
    id: uid(),
    agencyId: AG,
    sourceId: null,
    externalSystemId: null,
    filename: "sweep.pdf",
    classification: "internal",
    recordType: null,
    processingStatus: "ready",
    metadata: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

async function repoWith(docs: DocumentEntity[]): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.createAgency({ id: AG, slug: "swp-riverton", name: "Riverton", stateCode: "CA", observedHolidays: [] });
  for (const d of docs) await repo.createDocument(d);
  return repo;
}

describe("runRetentionSweep", () => {
  it("flags expiring and expired unheld documents in one admin event", async () => {
    const repo = await repoWith([
      docOf({ filename: "expiring.pdf", retentionUntil: new Date("2026-08-20T00:00:00Z") }),
      docOf({ filename: "expired.pdf", retentionUntil: new Date("2026-08-01T00:00:00Z") }),
      docOf({ filename: "safe.pdf", retentionUntil: new Date("2027-08-01T00:00:00Z") }),
    ]);
    const result = await runRetentionSweep(repo, AG, NOW);
    expect(result.atRisk).toBe(2);

    const events = await repo.listAdminEvents(AG);
    const sweep = events.find((e) => e.kind === "retention_sweep");
    expect(sweep).toBeTruthy();
    expect(sweep!.summary).toContain("2 document(s)");
    const flagged = (sweep!.payload as { documents: { filename: string; state: string }[] }).documents;
    expect(flagged.map((d) => d.filename).sort()).toEqual(["expired.pdf", "expiring.pdf"]);
  });

  it("a held document never alarms — the hold is the protection working", async () => {
    const repo = await repoWith([
      docOf({ retentionUntil: new Date("2026-08-01T00:00:00Z"), legalHoldReason: "Responsive to open request PR-2026-00001" }),
    ]);
    const result = await runRetentionSweep(repo, AG, NOW);
    expect(result.atRisk).toBe(0);
    expect((await repo.listAdminEvents(AG)).some((e) => e.kind === "retention_sweep")).toBe(false);
  });

  it("writes nothing when the agency has nothing at risk", async () => {
    const repo = await repoWith([docOf()]);
    const result = await runRetentionSweep(repo, AG, NOW);
    expect(result.atRisk).toBe(0);
    expect(await repo.listAdminEvents(AG)).toEqual([]);
  });
});
