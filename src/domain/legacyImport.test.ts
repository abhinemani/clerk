/**
 * Legacy import parsing tests — a real records office export is messy:
 * quoted fields, unfamiliar headers, inconsistent status strings. Reject a
 * ROW, never the whole file.
 */
import { describe, expect, it } from "vitest";
import { mapLegacyStatus, parseCsvTable, parseLegacyCsv, parseLegacyDate } from "./legacyImport";

describe("parseCsvTable", () => {
  it("splits plain rows on commas", () => {
    expect(parseCsvTable("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with embedded commas and doubled quotes", () => {
    const csv = 'name,note\n"Reyes, Jane","She said ""hello"""';
    expect(parseCsvTable(csv)).toEqual([
      ["name", "note"],
      ["Reyes, Jane", 'She said "hello"'],
    ]);
  });

  it("handles embedded newlines inside quotes and CRLF line endings", () => {
    const csv = 'a,b\r\n"line one\nline two",2\r\n';
    expect(parseCsvTable(csv)).toEqual([
      ["a", "b"],
      ["line one\nline two", "2"],
    ]);
  });

  it("drops blank lines", () => {
    expect(parseCsvTable("a,b\n\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("mapLegacyStatus", () => {
  it("maps common synonyms, case/spacing-insensitively", () => {
    expect(mapLegacyStatus("Open")).toEqual({ status: "in_progress", matched: true });
    expect(mapLegacyStatus("COMPLETED")).toEqual({ status: "fulfilled", matched: true });
    expect(mapLegacyStatus("in progress")).toEqual({ status: "in_progress", matched: true });
    expect(mapLegacyStatus("Cancelled")).toEqual({ status: "withdrawn", matched: true });
  });

  it("falls back to closed for anything unrecognized, flagged unmatched", () => {
    expect(mapLegacyStatus("purged")).toEqual({ status: "closed", matched: false });
    expect(mapLegacyStatus("")).toEqual({ status: "closed", matched: false });
  });
});

describe("parseLegacyDate", () => {
  it("accepts ISO and US slash dates", () => {
    expect(parseLegacyDate("2026-03-04")?.toISOString().slice(0, 10)).toBe("2026-03-04");
    expect(parseLegacyDate("3/4/2026")?.toISOString().slice(0, 10)).toBe("2026-03-04");
    expect(parseLegacyDate("03/04/2026")?.toISOString().slice(0, 10)).toBe("2026-03-04");
  });

  it("rejects garbage and blanks", () => {
    expect(parseLegacyDate("not a date")).toBeNull();
    expect(parseLegacyDate("")).toBeNull();
  });
});

const HEADER =
  "legacy_id,requester_name,requester_email,description,status,filed_date,due_date,closed_date,department,record_type";

describe("parseLegacyCsv", () => {
  it("parses a well-formed row end to end", () => {
    const csv = [
      HEADER,
      '"OLD-1",Jane Reyes,jane@example.com,"Sidewalk repair records",fulfilled,2024-01-15,2024-01-25,2024-01-24,Public Works,contract',
    ].join("\n");
    const { rows, errors } = parseLegacyCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.legacyId).toBe("OLD-1");
    expect(r.requesterEmail).toBe("jane@example.com");
    expect(r.status).toBe("fulfilled");
    expect(r.statusMatched).toBe(true);
    expect(r.receivedAt.toISOString().slice(0, 10)).toBe("2024-01-15");
    expect(r.dueAt?.toISOString().slice(0, 10)).toBe("2024-01-25");
    expect(r.closedAt?.toISOString().slice(0, 10)).toBe("2024-01-24");
    expect(r.department).toBe("Public Works");
    expect(r.recordType).toBe("contract");
    expect(r.warnings).toEqual([]);
  });

  it("recognizes alternate header spellings", () => {
    const csv = ["Case Number,Name,Email,Summary,Status,Date Received", '1,A,a@x.com,"x",new,2024-01-01'].join("\n");
    const { rows, errors, missingHeaders } = parseLegacyCsv(csv);
    expect(missingHeaders).toEqual([]);
    expect(errors).toEqual([]);
    expect(rows[0]!.legacyId).toBe("1");
    expect(rows[0]!.status).toBe("submitted");
  });

  it("skips a row missing description, keeps the rest of the batch", () => {
    const csv = [HEADER, ',,,"",new,2024-01-01,,,,', 'x,,,"Valid one",new,2024-01-02,,,,'].join("\n");
    const { rows, errors } = parseLegacyCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBe("Valid one");
    expect(errors).toEqual([{ rowNumber: 1, reason: expect.stringContaining("description") }]);
  });

  it("skips a row with an unparseable or missing filed date", () => {
    const csv = [HEADER, ',,,"desc",new,not-a-date,,,,'].join("\n");
    const { rows, errors } = parseLegacyCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors[0]!.reason).toContain("filed date");
  });

  it("warns but still imports on an unrecognized status, bad email, or terminal status with no close date", () => {
    const csv = [HEADER, ',,not-an-email,"desc",archived,2024-01-01,,,,'].join("\n");
    const { rows } = parseLegacyCsv(csv);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.status).toBe("closed"); // unrecognized -> safe terminal fallback
    expect(r.requesterEmail).toBeNull(); // bad email dropped, not fatal
    expect(r.warnings.some((w) => w.includes("archived"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("email"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("no closed date"))).toBe(true);
  });

  it("reports missing required headers instead of pretending to parse", () => {
    const { missingHeaders, rows } = parseLegacyCsv("foo,bar\n1,2");
    expect(missingHeaders).toEqual(expect.arrayContaining(["description", "receivedAt"]));
    expect(rows).toHaveLength(0);
  });

  it("handles an empty file", () => {
    expect(parseLegacyCsv("")).toEqual({ rows: [], errors: [], missingHeaders: expect.any(Array) });
  });
});
