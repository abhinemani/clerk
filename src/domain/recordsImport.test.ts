import { describe, expect, it } from "vitest";
import { parseRecordsCsv, rowFromUploadedFile, titleFromFilename, RECORDS_CSV_TEMPLATE } from "./recordsImport";

describe("parseRecordsCsv", () => {
  it("parses the shipped template", () => {
    const { rows, errors, missingHeaders } = parseRecordsCsv(RECORDS_CSV_TEMPLATE);
    expect(missingHeaders).toEqual([]);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      externalId: "AGENDA-2026-14",
      title: "City Council agenda, June 2, 2026",
      recordType: "agenda",
      tags: ["council", "agenda"],
      filename: "agenda-2026-06-02.pdf",
    });
    expect(rows[0]!.date?.toISOString().slice(0, 10)).toBe("2026-06-02");
    // Metadata-only row: no external id, no file — both fine.
    expect(rows[1]).toMatchObject({ externalId: null, filename: null });
  });

  it("accepts header synonyms and mixed case", () => {
    const { rows, missingHeaders } = parseRecordsCsv(
      ["Record Title,Description,Document Date,Category,File Name", "Minutes,Board minutes,3/4/2026,minutes,m.pdf"].join(
        "\n",
      ),
    );
    expect(missingHeaders).toEqual([]);
    expect(rows[0]).toMatchObject({
      title: "Minutes",
      summary: "Board minutes",
      recordType: "minutes",
      filename: "m.pdf",
    });
    expect(rows[0]!.date?.toISOString().slice(0, 10)).toBe("2026-03-04");
  });

  it("rejects a row without a title but keeps the rest", () => {
    const { rows, errors } = parseRecordsCsv(["title,summary", ",no title here", "Kept,fine"].join("\n"));
    expect(errors).toEqual([{ rowNumber: 1, reason: expect.stringContaining("Missing title") }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Kept");
  });

  it("reports a missing title column", () => {
    const { missingHeaders } = parseRecordsCsv("summary,date\nno title column,2026-01-01");
    expect(missingHeaders).toEqual(["title"]);
  });

  it("warns on an unparseable date instead of failing the row", () => {
    const { rows, errors } = parseRecordsCsv("title,date\nAgenda,sometime last spring");
    expect(errors).toEqual([]);
    expect(rows[0]!.date).toBeNull();
    expect(rows[0]!.warnings[0]).toContain("Unrecognized date");
  });

  it("rejects duplicate external ids within a batch", () => {
    const { rows, errors } = parseRecordsCsv(
      ["external_id,title", "R-1,First", "R-1,Second", "R-2,Third"].join("\n"),
    );
    expect(rows.map((r) => r.title)).toEqual(["First", "Third"]);
    expect(errors[0]!.reason).toContain("Duplicate external_id");
  });

  it("has no way to express a classification — bulk imports can never say public", () => {
    // A CSV that tries anyway: the column is simply not recognized.
    const { rows } = parseRecordsCsv("title,classification\nSneaky record,public");
    expect(rows[0]!.title).toBe("Sneaky record");
    expect(JSON.stringify(rows[0])).not.toContain("public");
  });

  it("splits tags and keywords on commas and semicolons", () => {
    const { rows } = parseRecordsCsv('title,tags,keywords\nDoc,"a; b, c","x;y"');
    expect(rows[0]!.tags).toEqual(["a", "b", "c"]);
    expect(rows[0]!.keywords).toEqual(["x", "y"]);
  });
});

describe("titleFromFilename", () => {
  it("strips the extension and turns separators into spaces", () => {
    expect(titleFromFilename("council_minutes-2026_06.pdf")).toBe("council minutes 2026 06");
  });

  it("drops any directory prefix (ZIP members carry folders)", () => {
    expect(titleFromFilename("minutes/2026/june.pdf")).toBe("june");
  });

  it("falls back to the raw name when stripping would leave nothing", () => {
    expect(titleFromFilename(".pdf")).toBe(".pdf");
  });
});

describe("rowFromUploadedFile", () => {
  it("produces a row with a derived title and everything else left for auto-classification", () => {
    const row = rowFromUploadedFile("Traffic Study Final.pdf", 3);
    expect(row).toEqual({
      rowNumber: 3,
      externalId: null,
      title: "Traffic Study Final",
      summary: null,
      date: null,
      recordType: null,
      tags: [],
      keywords: [],
      filename: "Traffic Study Final.pdf",
      warnings: [],
    });
  });
});
