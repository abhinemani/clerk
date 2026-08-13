import { describe, expect, it } from "vitest";
import { demandTerms, mineDemandPatterns, type DemandSignal } from "./demandPatterns";

const NOW = new Date("2026-08-13T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function sig(kind: DemandSignal["kind"], text: string, daysAgo: number, ref?: string): DemandSignal {
  return { kind, text, at: day(daysAgo), ref };
}

describe("demandTerms", () => {
  it("keeps content terms, drops stopwords/short/numeric tokens", () => {
    const terms = demandTerms("All records regarding the towing contracts since 2024");
    expect(terms.has("towing")).toBe(true);
    expect(terms.has("contracts")).toBe(true);
    expect(terms.has("records")).toBe(false); // domain stopword
    expect(terms.has("the")).toBe(false);
    expect(terms.has("2024")).toBe(false);
  });
});

describe("mineDemandPatterns", () => {
  it("clusters repeated demand across signal kinds and labels it", () => {
    const patterns = mineDemandPatterns(
      [
        sig("request", "towing contracts with vendors", 40, "PR-1"),
        sig("request", "copies of city towing contracts", 25, "PR-2"),
        sig("deflection_query", "towing contracts 2026", 10),
        sig("archive_miss", "vendor towing contracts", 5),
        sig("request", "police bodycam footage from main st", 12, "PR-3"),
      ],
      { now: NOW },
    );

    expect(patterns).toHaveLength(1); // bodycam is a singleton, below minCount
    const towing = patterns[0]!;
    expect(towing.keywords).toContain("towing");
    expect(towing.keywords).toContain("contracts");
    expect(towing.total).toBe(4);
    expect(towing.requests).toBe(2);
    expect(towing.queries).toBe(1);
    expect(towing.misses).toBe(1);
    expect(towing.refs).toEqual(["PR-1", "PR-2"]);
    expect(towing.lastAt).toEqual(day(5));
  });

  it("ignores signals outside the look-back window", () => {
    const patterns = mineDemandPatterns(
      [
        sig("request", "towing contracts", 200, "PR-1"),
        sig("request", "towing contracts", 150, "PR-2"),
        sig("request", "towing contracts", 10, "PR-3"),
      ],
      { now: NOW, windowDays: 90 },
    );
    expect(patterns).toHaveLength(0); // only one in-window signal
  });

  it("respects minCount and maxPatterns, strongest cluster first", () => {
    const signals: DemandSignal[] = [];
    for (let i = 0; i < 5; i++) signals.push(sig("request", "street sweeping schedule", 30 - i, `PR-S${i}`));
    for (let i = 0; i < 3; i++) signals.push(sig("deflection_query", "budget salaries department", 20 - i));
    signals.push(sig("archive_miss", "totally unrelated drone footage", 5));

    const patterns = mineDemandPatterns(signals, { now: NOW, minCount: 3, maxPatterns: 1 });
    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.keywords).toContain("sweeping");
    expect(patterns[0]!.total).toBe(5);
  });

  it("is deterministic: same input, same output", () => {
    const signals = [
      sig("request", "fire inspection reports downtown", 30, "PR-1"),
      sig("request", "fire inspection reports 2026", 20, "PR-2"),
      sig("archive_miss", "fire inspections", 10),
    ];
    const a = mineDemandPatterns(signals, { now: NOW });
    const b = mineDemandPatterns(signals, { now: NOW });
    expect(a).toEqual(b);
  });
});
