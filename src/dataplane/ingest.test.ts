/** Tests for the ingestion normalization + core (spec §9.1, §9.3, §6.5). */
import { describe, expect, it } from "vitest";
import { InMemoryRepository, type Agency } from "@/services/repository";
import { normalizeIngest, type SourceConfig } from "./normalize";
import { ingestRecord, type IngestContext } from "./ingest";

const AGENCY: Agency = { id: "ag-1", slug: "riverton", name: "Riverton", stateCode: "CA", observedHolidays: [] };
const AUTO: SourceConfig = { id: "src-auto", trust: "auto_publish", defaultClassification: "public" };
const REVIEW: SourceConfig = { id: "src-rev", trust: "review_queue", defaultClassification: "internal" };

const genDeps = () => {
  let n = 0;
  return { genId: () => `doc-${++n}`, now: () => new Date("2026-07-27T12:00:00Z"), agencyId: "ag-1" };
};

describe("normalizeIngest", () => {
  it("auto-publishes a clean public record from a trusted source", () => {
    const r = normalizeIngest(
      { externalId: "minutes-2025-01", text: "Council approved the budget.", classification: "public" },
      AUTO,
      genDeps(),
    );
    expect(r.held).toBe(false);
    expect(r.publicVisible).toBe(true);
    expect(r.document.processingStatus).toBe("ready");
  });

  it("holds anything from a review-queue source", () => {
    const r = normalizeIngest({ externalId: "x", text: "nothing sensitive" }, REVIEW, genDeps());
    expect(r.held).toBe(true);
    expect(r.publicVisible).toBe(false);
    expect(r.holdReason).toMatch(/review-queue/);
  });

  it("forces a hold when the sensitivity pre-scan finds high-risk PII — even on an auto-publish source", () => {
    const r = normalizeIngest(
      { externalId: "contract-ssn", text: "Vendor SSN 123-45-6789 on file.", classification: "public" },
      AUTO,
      genDeps(),
    );
    expect(r.held).toBe(true);
    expect(r.publicVisible).toBe(false);
    expect(r.holdReason).toMatch(/probable PII/i);
    expect(r.sensitivity.ssn).toBe(1);
  });

  it("carries the deep link and metadata onto the document", () => {
    const r = normalizeIngest(
      { externalId: "c1", metadata: { vendor: "Acme", amount: 50000 }, deepLink: "https://erp/records/c1" },
      AUTO,
      genDeps(),
    );
    expect(r.document.metadata?.vendor).toBe("Acme");
    expect(r.document.metadata?.deepLink).toBe("https://erp/records/c1");
  });
});

describe("ingestRecord", () => {
  function ctx(source: SourceConfig = AUTO): IngestContext {
    let n = 0;
    return {
      repo: new InMemoryRepository().seedAgency(AGENCY),
      agency: AGENCY,
      source,
      genId: () => `doc-${++n}`,
      now: () => new Date("2026-07-27T12:00:00Z"),
    };
  }

  it("creates on first push and updates on re-push of the same external id (idempotent)", async () => {
    const c = ctx();
    const first = await ingestRecord(c, { externalId: "po-100", filename: "po-100.pdf", classification: "public" });
    expect(first.status).toBe(201);
    expect(first.body.created).toBe(true);

    const second = await ingestRecord(c, { externalId: "po-100", filename: "po-100-rev.pdf", classification: "public" });
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.id).toBe(first.body.id); // same document
  });

  it("rejects an invalid payload with 400", async () => {
    const out = await ingestRecord(ctx(), { deepLink: "not-a-url", bogus: true });
    expect(out.status).toBe(400);
    expect(out.body.error).toBe("invalid_payload");
  });

  it("reports a held document from a review-queue source", async () => {
    const out = await ingestRecord(ctx(REVIEW), { externalId: "x", text: "hello" });
    expect(out.body.held).toBe(true);
    expect(out.body.status).toBe("held");
  });
});
