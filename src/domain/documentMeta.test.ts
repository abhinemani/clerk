import { describe, expect, it } from "vitest";
import { patchDocumentMeta, readDocumentMeta, sensitivitySummary } from "./documentMeta";

describe("readDocumentMeta", () => {
  it("parses a well-formed metadata object", () => {
    const meta = readDocumentMeta({
      metadata: {
        title: "Paving schedule",
        tags: ["public works"],
        recordDate: "2026-05-20",
        publicationDecision: { decision: "published", byUserId: "u1", byName: "Casey", at: "2026-08-05T12:00:00Z" },
        sensitivity: { ssn: 2 },
      },
    });
    expect(meta.title).toBe("Paving schedule");
    expect(meta.publicationDecision?.byName).toBe("Casey");
    expect(meta.sensitivity).toEqual({ ssn: 2 });
  });

  it("never throws: null metadata and junk both read as empty", () => {
    expect(readDocumentMeta({ metadata: null })).toEqual({});
    expect(readDocumentMeta({ metadata: { title: 42, tags: "not-an-array" } as never }).title).toBeUndefined();
  });

  it("salvages per-field: one malformed key doesn't blank the rest", () => {
    const meta = readDocumentMeta({
      metadata: { title: "Kept", tags: "corrupt-string", summary: "Also kept" } as never,
    });
    expect(meta.title).toBe("Kept");
    expect(meta.summary).toBe("Also kept");
    expect(meta.tags).toBeUndefined(); // the bad key dropped, alone
  });

  it("passes unknown keys through untouched", () => {
    const meta = readDocumentMeta({ metadata: { title: "T", connectorCursor: "abc123" } });
    expect((meta as Record<string, unknown>).connectorCursor).toBe("abc123");
  });
});

describe("patchDocumentMeta", () => {
  it("merges over existing keys and preserves unknown ones", () => {
    const merged = patchDocumentMeta(
      { metadata: { title: "Old", vendorField: "keep-me" } },
      { title: "New", releasedOn: "2026-08-05" },
    );
    expect(merged).toMatchObject({ title: "New", releasedOn: "2026-08-05", vendorField: "keep-me" });
  });
});

describe("sensitivitySummary", () => {
  it("formats non-zero tallies and returns null when clean", () => {
    expect(sensitivitySummary({ sensitivity: { ssn: 2, credit_card: 1, phone: 0 } })).toBe("ssn ×2, credit card ×1");
    expect(sensitivitySummary({ sensitivity: {} })).toBeNull();
    expect(sensitivitySummary({})).toBeNull();
  });
});
