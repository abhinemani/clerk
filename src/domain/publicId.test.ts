/** Tests for public request IDs (spec §5). */
import { describe, expect, it } from "vitest";
import { formatPublicId, isPublicId, parsePublicId } from "./publicId";

describe("formatPublicId", () => {
  it("zero-pads the sequence to 5 digits", () => {
    expect(formatPublicId(2026, 341)).toBe("PR-2026-00341");
    expect(formatPublicId(2026, 1)).toBe("PR-2026-00001");
  });

  it("does not truncate sequences beyond 5 digits", () => {
    expect(formatPublicId(2026, 123456)).toBe("PR-2026-123456");
  });

  it("rejects invalid years and sequences", () => {
    expect(() => formatPublicId(26, 1)).toThrow(RangeError);
    expect(() => formatPublicId(2026, -1)).toThrow(RangeError);
    expect(() => formatPublicId(2026, 1.5)).toThrow(RangeError);
  });
});

describe("parsePublicId", () => {
  it("round-trips a formatted id", () => {
    expect(parsePublicId("PR-2026-00341")).toEqual({ year: 2026, sequence: 341 });
    expect(parsePublicId("PR-2026-123456")).toEqual({ year: 2026, sequence: 123456 });
  });

  it("returns null for non-matching strings", () => {
    expect(parsePublicId("2026-00341")).toBeNull();
    expect(parsePublicId("PR-26-1")).toBeNull();
    expect(parsePublicId("garbage")).toBeNull();
  });

  it("isPublicId agrees with parse", () => {
    expect(isPublicId("PR-2026-00341")).toBe(true);
    expect(isPublicId("nope")).toBe(false);
  });
});
