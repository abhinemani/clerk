/**
 * Invariant 11's test suite (docs/invariants.md, docs/network-plays.md).
 *
 * The invariant names four things this file must prove:
 *   1. no output field contains input request text, publicId, uuid, or vector,
 *      and unmappable inputs yield null;
 *   2. withholding at each floor minus one, including the dominant-agency case;
 *   3. a revoked (non-consenting) agency contributes nothing;
 *   4. network-derived confidence ranks below the local cap and cannot
 *      auto-dispatch.
 *
 * Treat these as append-only — the invariants doc says so, and a weakened
 * test here is indistinguishable from a weakened guarantee.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_AUTO_DISPATCH_CONFIDENCE } from "./workflow";
import {
  MAX_AGENCY_SHARE,
  MIN_AGENCIES,
  MIN_EPISODES,
  NETWORK_CONFIDENCE_CAP,
  networkRoutingHint,
  publishableAggregates,
  toNetworkContribution,
  type NetworkContribution,
  type ProjectablePlay,
  type ProjectionContext,
} from "./networkPlays";
import { toDepartmentRole, toStatuteSection, toTopicCode } from "./networkVocabulary";

const CA_EXEMPTIONS = [
  { statuteSection: "Cal. Gov. Code § 7927.700", shortLabel: "Personal privacy" },
  { statuteSection: "Cal. Gov. Code § 7923.600", shortLabel: "Law enforcement investigation" },
];

const ctx = (over: Partial<ProjectionContext> = {}): ProjectionContext => ({
  consented: true,
  agencyId: "ag-1",
  stateCode: "CA",
  profileExemptions: CA_EXEMPTIONS,
  ...over,
});

const play = (over: Partial<ProjectablePlay> = {}): ProjectablePlay => ({
  keywords: ["building", "permit", "construction"],
  episodeCount: 6,
  stats: {
    routes: [{ department: "Public Works", share: 0.83 }],
    exemptions: [{ label: "Personal privacy", count: 2 }],
    medianDaysToClose: 6,
    extensionRate: 0.15,
    ...over.stats,
  },
  ...over,
});

/** A contribution for floor tests — bypasses projection deliberately. */
const contrib = (over: Partial<NetworkContribution> = {}): NetworkContribution => ({
  agencyId: "ag-1",
  stateCode: "CA",
  topic: "building_permits",
  episodeCount: 5,
  routes: [{ role: "public_works", share: 0.8 }],
  exemptionSections: ["Cal. Gov. Code § 7927.700"],
  daysToClose: "4-7",
  extensionRate: "10-25%",
  ...over,
});

/** N agencies, evenly weighted — the "everything passes" baseline. */
function evenGroup(n: number, episodesEach: number): NetworkContribution[] {
  return Array.from({ length: n }, (_, i) =>
    contrib({ agencyId: `ag-${i}`, episodeCount: episodesEach }),
  );
}

// --- 1. nothing tenant-authored crosses ------------------------------------

describe("invariant 11 — no tenant-authored value crosses the boundary", () => {
  it("drops every marker string planted in a play (text, ids, labels)", () => {
    // The codebase's own idiom for this class of proof (see the invariant-3
    // conformance tests): plant distinctive markers, assert they never
    // surface in any shape.
    const MARKERS = [
      "MARKER-REQUESTER-WORDING",
      "MARKER-PUBLIC-ID-PR-2026-00341",
      "MARKER-CLERK-FREE-TEXT",
      "MARKER-DEPARTMENT-NAME",
    ];
    const c = toNetworkContribution(
      play({
        // topic is derived from keywords — the trap that motivated the design
        keywords: ["building", "permit", "MARKER-REQUESTER-WORDING"],
        stats: {
          routes: [{ department: "Public Works MARKER-DEPARTMENT-NAME", share: 0.9 }],
          // exemptionLabel is `reasons.join("; ")` — literally clerk free text
          exemptions: [{ label: "Personal privacy; MARKER-CLERK-FREE-TEXT", count: 3 }],
          medianDaysToClose: 6,
          extensionRate: 0.2,
        },
      }),
      ctx(),
    );
    expect(c).not.toBeNull();
    const serialized = JSON.stringify(c);
    for (const marker of MARKERS) expect(serialized).not.toContain(marker);
  });

  it("never emits an exact numeric that could be differenced (days, rate)", () => {
    const c = toNetworkContribution(
      play({ stats: { ...play().stats, medianDaysToClose: 37, extensionRate: 0.42 } }),
      ctx(),
    )!;
    // The exact values 37 and 0.42 must not appear anywhere — only buckets.
    expect(JSON.stringify(c)).not.toContain("37");
    expect(JSON.stringify(c)).not.toContain("0.42");
    expect(c.daysToClose).toBe("31-60");
    expect(c.extensionRate).toBe("25-50%");
  });

  it("carries no embedding, ever — a centroid over few members is text in disguise", () => {
    const withVector = { ...play(), embedding: [0.11, 0.22, 0.33] } as ProjectablePlay;
    const c = toNetworkContribution(withVector, ctx())!;
    expect("embedding" in c).toBe(false);
    expect(JSON.stringify(c)).not.toContain("0.11");
  });

  it("drops an unmappable play rather than passing free text through", () => {
    expect(toNetworkContribution(play({ keywords: ["zzzz", "qqqq"] }), ctx())).toBeNull();
    expect(toNetworkContribution(play({ keywords: [] }), ctx())).toBeNull();
    expect(toTopicCode(["nothing", "matches", "here"])).toBeNull();
  });

  it("drops an AMBIGUOUS topic rather than guessing one", () => {
    // Two DEFINING terms from different topics is genuine ambiguity, and a
    // guessed mapping would file this agency's practice into another
    // agency's benchmark. Ties drop.
    expect(toTopicCode(["ballot", "curriculum"])).toBeNull();
    // But a defining term legitimately beats a merely supporting one —
    // that is a decision, not a coin flip.
    expect(toTopicCode(["election", "school"])).toBe("elections");
  });

  it("will not mis-file on a generic supporting term alone", () => {
    // Regression: "report" is a supporting term of police_incident_reports.
    // Under unweighted counting, an annual-report play matched it, was the
    // only match, and WON — silently filing budget history as police data.
    expect(toTopicCode(["annual", "report"])).toBeNull();
    expect(toTopicCode(["safety"])).toBeNull(); // supporting-only, several topics
    // With a defining term present, the same supporting term is fine.
    expect(toTopicCode(["arrest", "report"])).toBe("police_incident_reports");
  });

  it("only lets a statute section cross when the label unambiguously names one", () => {
    expect(toStatuteSection("Personal privacy", CA_EXEMPTIONS)).toBe("Cal. Gov. Code § 7927.700");
    // Free text that names no known section → nothing crosses.
    expect(toStatuteSection("redacted per the chief's request", CA_EXEMPTIONS)).toBeNull();
    // Names two → ambiguous → nothing crosses.
    expect(
      toStatuteSection("Personal privacy and Law enforcement investigation", CA_EXEMPTIONS),
    ).toBeNull();
  });

  it("a published aggregate names no agency and no exact per-agency count", () => {
    const [agg] = publishableAggregates(evenGroup(MIN_AGENCIES, 10));
    expect(agg).toBeDefined();
    const serialized = JSON.stringify(agg);
    for (let i = 0; i < MIN_AGENCIES; i++) expect(serialized).not.toContain(`ag-${i}`);
    expect(serialized).not.toContain("agencyId");
    // The per-agency episode count (10) must not leak; only a bucket.
    expect(agg!.episodes).toBe("50-99");
  });
});

// --- 2. consent ------------------------------------------------------------

describe("invariant 11 — consent is checked at the chokepoint", () => {
  it("produces nothing for a non-consenting (or revoked) agency", () => {
    expect(toNetworkContribution(play(), ctx({ consented: false }))).toBeNull();
  });

  it("revocation removes that agency's contribution from the next publication", () => {
    const all = evenGroup(MIN_AGENCIES, 10);
    expect(publishableAggregates(all)).toHaveLength(1);
    // One agency revokes → its contribution is not produced → the group
    // drops below the agency floor and the aggregate is withheld entirely.
    const afterRevocation = all.filter((c) => c.agencyId !== "ag-0");
    expect(publishableAggregates(afterRevocation)).toHaveLength(0);
  });
});

// --- 3. floors: suppression, never padding ---------------------------------

describe("invariant 11 — floors withhold rather than round", () => {
  it("publishes at exactly the floors", () => {
    const out = publishableAggregates(evenGroup(MIN_AGENCIES, MIN_EPISODES / MIN_AGENCIES));
    expect(out).toHaveLength(1);
    expect(out[0]!.agencyCount).toBe(MIN_AGENCIES);
  });

  it("withholds at MIN_AGENCIES − 1", () => {
    expect(publishableAggregates(evenGroup(MIN_AGENCIES - 1, 50))).toHaveLength(0);
  });

  it("withholds at MIN_EPISODES − 1", () => {
    const each = Math.floor((MIN_EPISODES - 1) / MIN_AGENCIES);
    const group = evenGroup(MIN_AGENCIES, each);
    const total = group.reduce((n, c) => n + c.episodeCount, 0);
    expect(total).toBeLessThan(MIN_EPISODES);
    expect(publishableAggregates(group)).toHaveLength(0);
  });

  it("withholds when one agency dominates, even with enough agencies and episodes", () => {
    // 5 agencies, 100 episodes — both floors cleared — but one agency is 60%.
    const group = [
      contrib({ agencyId: "ag-big", episodeCount: 60 }),
      ...Array.from({ length: 4 }, (_, i) => contrib({ agencyId: `ag-${i}`, episodeCount: 10 })),
    ];
    expect(group.length).toBeGreaterThanOrEqual(MIN_AGENCIES);
    expect(group.reduce((n, c) => n + c.episodeCount, 0)).toBeGreaterThanOrEqual(MIN_EPISODES);
    expect(60 / 100).toBeGreaterThan(MAX_AGENCY_SHARE);
    expect(publishableAggregates(group)).toHaveLength(0);
  });

  it("cannot be gamed by one agency submitting many rows", () => {
    // Five rows, all the same agency: still one agency, still withheld.
    const stuffed = Array.from({ length: MIN_AGENCIES }, () => contrib({ episodeCount: 20 }));
    expect(publishableAggregates(stuffed)).toHaveLength(0);
  });

  it("withholds an exemption section that fewer than MIN_AGENCIES agencies cite", () => {
    const group = evenGroup(MIN_AGENCIES, 10).map((c, i) => ({
      ...c,
      // Only two of five cite the second section.
      exemptionSections:
        i < 2
          ? ["Cal. Gov. Code § 7927.700", "Cal. Gov. Code § 7923.600"]
          : ["Cal. Gov. Code § 7927.700"],
    }));
    const [agg] = publishableAggregates(group);
    const sections = agg!.exemptionSections.map((s) => s.section);
    expect(sections).toContain("Cal. Gov. Code § 7927.700"); // all five cite it
    expect(sections).not.toContain("Cal. Gov. Code § 7923.600"); // only two — withheld
  });

  it("groups by state and topic, so unlike things are never pooled", () => {
    const mixed = [
      ...evenGroup(MIN_AGENCIES, 10),
      ...evenGroup(MIN_AGENCIES, 10).map((c, i) => ({
        ...c,
        agencyId: `tx-${i}`,
        stateCode: "TX",
      })),
    ];
    const out = publishableAggregates(mixed);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((a) => a.stateCode))).toEqual(new Set(["CA", "TX"]));
    // A state that alone would miss the floor stays withheld.
    const lopsided = [...evenGroup(MIN_AGENCIES, 10), contrib({ agencyId: "ny-1", stateCode: "NY" })];
    expect(publishableAggregates(lopsided).map((a) => a.stateCode)).toEqual(["CA"]);
  });
});

// --- 4. advisory only ------------------------------------------------------

describe("invariant 11 — network signals are advisory and rank below local ones", () => {
  it("caps displayed confidence below the local learned-play cap (0.9)", () => {
    const [agg] = publishableAggregates(evenGroup(MIN_AGENCIES, 10));
    const hint = networkRoutingHint(agg!)!;
    expect(hint.confidence).toBeLessThanOrEqual(NETWORK_CONFIDENCE_CAP);
    expect(NETWORK_CONFIDENCE_CAP).toBeLessThan(0.9);
  });

  it("cannot clear the DEFAULT auto-dispatch threshold", () => {
    expect(NETWORK_CONFIDENCE_CAP).toBeLessThan(DEFAULT_AUTO_DISPATCH_CONFIDENCE);
  });

  it("is structurally excluded from auto-dispatch, not merely numerically", () => {
    // The real guarantee: a hint is NOT a LearnedRoutingSuggestion, so it
    // cannot be handed to autoDispatchSuggestions at all. An agency may set
    // its threshold as low as 0.5, so no numeric cap could promise this —
    // only the type can. This test pins the shape difference.
    const [agg] = publishableAggregates(evenGroup(MIN_AGENCIES, 10));
    const hint = networkRoutingHint(agg!)!;
    expect(Object.keys(hint).sort()).toEqual(["basis", "confidence", "role"]);
    // A LearnedRoutingSuggestion carries a departmentId; a network hint has
    // no tenant-local id to give, which is exactly why it can't dispatch.
    expect("departmentId" in hint).toBe(false);
  });

  it("states its own basis so a human can weigh it", () => {
    const [agg] = publishableAggregates(evenGroup(MIN_AGENCIES, 10));
    expect(agg!.basis).toContain(`${MIN_AGENCIES} consenting CA agencies`);
    expect(networkRoutingHint(agg!)!.basis).toContain("public_works");
  });
});

// --- projection happy path -------------------------------------------------

describe("toNetworkContribution — the mapping that does survive", () => {
  it("maps a well-formed play onto controlled-vocabulary symbols only", () => {
    const c = toNetworkContribution(play(), ctx())!;
    expect(c).toEqual({
      agencyId: "ag-1",
      stateCode: "CA",
      topic: "building_permits",
      episodeCount: 6,
      routes: [{ role: "public_works", share: 0.83 }],
      exemptionSections: ["Cal. Gov. Code § 7927.700"],
      daysToClose: "4-7",
      extensionRate: "10-25%",
    });
  });

  it("merges tenant departments that mean the same role", () => {
    const c = toNetworkContribution(
      play({
        stats: {
          ...play().stats,
          routes: [
            { department: "Street Maintenance", share: 0.5 },
            { department: "Department of Sanitation", share: 0.3 },
          ],
        },
      }),
      ctx(),
    )!;
    expect(c.routes).toEqual([{ role: "public_works", share: 0.8 }]);
  });

  it("refuses a malformed state code", () => {
    expect(toNetworkContribution(play(), ctx({ stateCode: "California" }))).toBeNull();
  });

  it("maps real-world department names in both singular and plural forms", () => {
    // Regression: the trigger term was once the plural "streets", which does
    // NOT substring-match "Street Maintenance" — the route silently vanished.
    // Substring triggers must be the shorter form; both directions are pinned.
    for (const name of [
      "Street Maintenance",
      "Streets Division",
      "Department of Public Works",
      "Sanitation",
    ]) {
      expect(toDepartmentRole(name)).toBe("public_works");
    }
    for (const name of ["Parks & Recreation", "Park District", "Recreation Services"]) {
      expect(toDepartmentRole(name)).toBe("parks");
    }
    expect(toDepartmentRole("Police Records")).toBe("police");
    expect(toDepartmentRole("City Clerk")).toBe("clerk");
  });

  it("prefers no role over a false one when a generic word collides", () => {
    // "Lawn Maintenance" must not become police via a bare "law" trigger.
    expect(toDepartmentRole("Lawn Maintenance")).not.toBe("police");
    expect(toDepartmentRole("")).toBeNull();
    expect(toDepartmentRole(null)).toBeNull();
  });
});
