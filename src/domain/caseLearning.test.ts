import { describe, expect, it } from "vitest";
import type { RequestEntity, ReviewEntity, TaskEntity } from "@/services/repository";
import {
  buildPlays,
  centroidOf,
  distillEpisode,
  matchPlay,
  matchPlayByEmbedding,
  routingSuggestionFrom,
  type CaseEpisode,
} from "./caseLearning";

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

function req(id: string, text: string, opts: Partial<RequestEntity> = {}): RequestEntity {
  return {
    id,
    agencyId: "ag-1",
    publicId: `PR-${id}`,
    requesterId: null,
    status: "fulfilled",
    rawText: text,
    interpretedScope: null,
    recordTypes: [],
    complexityScore: null,
    receivedAt: day(1),
    statutoryDueAt: day(11),
    closedAt: day(8),
    createdAt: day(1),
    ...opts,
  } as RequestEntity;
}

function task(requestId: string, departmentId: string, status: TaskEntity["status"] = "done"): TaskEntity {
  return {
    id: `t-${requestId}-${departmentId}`,
    agencyId: "ag-1",
    requestId,
    departmentId,
    scopeText: "",
    status,
    token: "tok",
    dueAt: null,
    uploads: [],
    pushbackNotes: null,
  } as TaskEntity;
}

const DEPTS = new Map([
  ["d-pw", "Public Works"],
  ["d-pd", "Police Records"],
]);

describe("distillEpisode", () => {
  it("captures routes (done tasks only), exemptions, timing, and extensions", () => {
    const r = req("1", "towing contracts with vendors", {
      extensionHistory: [{ at: day(5).toISOString(), byUserId: "u", days: 14, reason: "volume" }],
    });
    const reviews: ReviewEntity[] = [
      { id: "rv1", agencyId: "ag-1", requestId: "1", documentId: "d1", decision: "release_redacted", exemptionLabel: "Personal privacy", decidedByUserId: "u", createdAt: day(6) },
    ];
    const ep = distillEpisode(r, [task("1", "d-pw"), task("1", "d-pd", "cancelled")], reviews, DEPTS)!;

    expect(ep.routes).toEqual([{ departmentId: "d-pw", department: "Public Works" }]); // cancelled excluded
    expect(ep.exemptions).toEqual(["Personal privacy"]);
    expect(ep.daysToClose).toBe(7);
    expect(ep.tookExtension).toBe(true);
    expect(ep.outcome).toBe("fulfilled");
  });

  it("returns null for open requests — only closed cases teach", () => {
    expect(distillEpisode(req("1", "anything here", { closedAt: null }), [], [], DEPTS)).toBeNull();
  });
});

function episodes(): CaseEpisode[] {
  const mk = (id: string, text: string, dept: string, opts: Partial<RequestEntity> = {}) =>
    distillEpisode(req(id, text, opts), [task(id, dept)], [], DEPTS)!;
  return [
    mk("1", "towing contracts with vendors", "d-pw"),
    mk("2", "city towing contracts 2025", "d-pw"),
    mk("3", "towing contracts invoices", "d-pw", { status: "partially_fulfilled" }),
    mk("4", "bodycam footage main street incident", "d-pd"),
    mk("5", "bodycam footage from the parade", "d-pd"),
  ];
}

describe("buildPlays", () => {
  const plays = buildPlays(episodes());

  it("clusters by topic and aggregates route shares", () => {
    expect(plays).toHaveLength(2);
    const towing = plays[0]!; // 3 episodes > 2
    expect(towing.episodeCount).toBe(3);
    expect(towing.keywords).toContain("towing");
    expect(towing.stats.routes[0]).toMatchObject({ department: "Public Works", share: 1 });
    expect(towing.stats.outcomes).toEqual({ fulfilled: 2, partially_fulfilled: 1 });
    expect(towing.stats.medianDaysToClose).toBe(7);
    expect(towing.stats.samplePublicIds).toHaveLength(3);
  });

  it("drops singletons — one case is an anecdote, not a pattern", () => {
    const withStray = [...episodes(), distillEpisode(req("9", "drone procurement records"), [task("9", "d-pw")], [], DEPTS)!];
    const built = buildPlays(withStray);
    expect(built.some((p) => p.keywords.includes("drone"))).toBe(false);
  });

  it("is deterministic", () => {
    expect(buildPlays(episodes())).toEqual(buildPlays(episodes()));
  });
});

describe("matchPlay + routingSuggestionFrom", () => {
  const plays = buildPlays(episodes());

  it("matches a new ask to the learned cluster", () => {
    const m = matchPlay(plays, "all towing contracts since January")!;
    expect(m.play.keywords).toContain("towing");
    expect(m.score).toBeGreaterThanOrEqual(0.5);
    expect(m.matchedBy).toBe("terms");
    expect(matchPlay(plays, "zoning variance appeals")).toBeNull();
  });

  it("carries the member request ids so the rebuild can average their vectors", () => {
    const towing = plays[0]!;
    expect(towing.memberRequestIds.sort()).toEqual(["1", "2", "3"]);
  });

  it("earns confidence from evidence and never reaches the rules' 1.0", () => {
    const towing = plays[0]!;
    const s = routingSuggestionFrom(towing)!;
    expect(s.department).toBe("Public Works");
    // share 1.0 × evidence 3/5 = 0.6 — three cases is a lead, not a law.
    expect(s.confidence).toBe(0.6);
    expect(s.rationale).toContain("3 similar past request(s)");

    // Even overwhelming evidence stays below explicit rules.
    const veteran = { ...towing, episodeCount: 40 };
    expect(routingSuggestionFrom(veteran)!.confidence).toBeLessThanOrEqual(0.9);
  });
});

describe("centroidOf (v2)", () => {
  it("averages and L2-normalizes member vectors", () => {
    const c = centroidOf([
      [1, 0],
      [0, 1],
    ])!;
    // mean is [0.5, 0.5]; normalized to unit length.
    expect(c[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(c[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Math.hypot(...c)).toBeCloseTo(1, 6);
  });

  it("skips empty vectors and returns null when nothing usable remains", () => {
    expect(centroidOf([])).toBeNull();
    expect(centroidOf([[], []])).toBeNull();
    expect(centroidOf([[], [3, 4]])).toEqual([0.6, 0.8]);
  });

  it("refuses mismatched dimensions rather than averaging garbage", () => {
    expect(centroidOf([[1, 0], [1, 0, 0]])).toBeNull();
  });

  it("returns null for a zero centroid (opposed vectors cancel)", () => {
    expect(centroidOf([[1, 0], [-1, 0]])).toBeNull();
  });
});

describe("matchPlayByEmbedding (v2)", () => {
  const towing = { topic: "towing", embedding: [1, 0, 0] };
  const bodycam = { topic: "bodycam", embedding: [0, 1, 0] };
  const lexicalOnly = { topic: "old play", embedding: null };

  it("matches a paraphrase by vector similarity and says so", () => {
    const m = matchPlayByEmbedding([towing, bodycam, lexicalOnly], [0.95, 0.05, 0])!;
    expect(m.play.topic).toBe("towing");
    expect(m.matchedBy).toBe("meaning");
    expect(m.score).toBeGreaterThanOrEqual(0.6);
  });

  it("stays conservative: below the 0.6 bar nothing matches", () => {
    // ~45° off both centroids — cosine ≈ 0.7 to each would match, so use a
    // vector far from both instead.
    expect(matchPlayByEmbedding([towing, bodycam], [0.3, 0.3, 0.9])).toBeNull();
  });

  it("ignores plays without a centroid and empty ask vectors", () => {
    expect(matchPlayByEmbedding([lexicalOnly], [1, 0, 0])).toBeNull();
    expect(matchPlayByEmbedding([towing], [])).toBeNull();
  });
});
