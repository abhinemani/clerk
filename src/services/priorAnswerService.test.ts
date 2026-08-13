import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "./repository";
import { findPriorAnswers } from "./priorAnswerService";
import { FakeModelClient } from "@/ai/modelClient";

const AG = "ag-1";

function repoWith() {
  return new InMemoryRepository().seedAgency({
    id: AG,
    slug: "riverton",
    name: "Riverton",
    stateCode: "CA",
    observedHolidays: [],
  });
}

let seq = 0;
const id = () => `id-${++seq}`;

/**
 * Seed one answered request with a release and a document. `visibility` is the
 * release's, `classification` the document's — the two gates are independent
 * and both tested below.
 */
async function seedAnswered(
  repo: InMemoryRepository,
  opts: {
    ask: string;
    visibility: "public" | "private";
    classification: "public" | "internal";
    status?: string;
    title?: string;
  },
) {
  const requestId = id();
  const publicId = `PR-${requestId}`;
  await repo.createRequest({
    id: requestId,
    agencyId: AG,
    publicId,
    rawText: opts.ask,
    interpretedScope: opts.ask,
    status: (opts.status ?? "fulfilled") as never,
    requesterName: "Wei",
    requesterEmail: "wei@example.com",
    requesterUserId: null,
    assignedToUserId: null,
    dueAt: new Date("2026-09-01T00:00:00Z"),
    createdAt: new Date("2026-08-01T00:00:00Z"),
    closedAt: new Date("2026-08-05T00:00:00Z"),
  } as never);

  const docId = id();
  await repo.createDocument({
    id: docId,
    agencyId: AG,
    filename: opts.title ?? "record.pdf",
    classification: opts.classification,
    metadata: { title: opts.title ?? "Released record" },
    createdAt: new Date("2026-08-02T00:00:00Z"),
  } as never);
  await repo.linkRequestDocument(AG, requestId, docId);

  await repo.createRelease({
    id: id(),
    agencyId: AG,
    requestId,
    artifacts: [],
    responseLetter: null,
    visibility: opts.visibility,
    approvedByUserId: "user-1",
    releasedAt: new Date("2026-08-05T00:00:00Z"),
  } as never);

  return { requestId, publicId, docId };
}

/** Scripted judge — the tests drive the model's verdict directly so they
 *  assert OUR logic (floors, id reconciliation, scoping) rather than model
 *  behaviour. Same convention as the other pipeline tests. */
function judge(matches: unknown[]) {
  return new FakeModelClient([{ matches }]);
}

describe("findPriorAnswers — disclosure fork", () => {
  it("never offers a requester records from a PRIVATE release", async () => {
    const repo = repoWith();
    await seedAnswered(repo, {
      ask: "street cleaning schedules for downtown",
      visibility: "private",
      classification: "public",
    });

    const r = await findPriorAnswers({ repo }, {
      agencyId: AG,
      ask: "street cleaning schedules for downtown",
      audience: "requester",
    });

    // Scoped out before retrieval — it is not merely absent from the results,
    // it was never a candidate.
    expect(r.considered).toBe(0);
    expect(r.matches).toEqual([]);
  });

  it("never offers a requester a document that is not classified public", async () => {
    const repo = repoWith();
    // Release was public, but the record itself was later unpublished.
    await seedAnswered(repo, {
      ask: "street cleaning schedules for downtown",
      visibility: "public",
      classification: "internal",
    });

    const r = await findPriorAnswers({ repo }, {
      agencyId: AG,
      ask: "street cleaning schedules for downtown",
      audience: "requester",
    });
    expect(r.considered).toBe(0);
  });

  it("does consider a public release of a public record", async () => {
    const repo = repoWith();
    await seedAnswered(repo, {
      ask: "street cleaning schedules for downtown",
      visibility: "public",
      classification: "public",
    });

    const r = await findPriorAnswers({ repo }, {
      agencyId: AG,
      ask: "street cleaning schedules downtown",
      audience: "requester",
    });
    expect(r.considered).toBe(1);
  });

  it("lets STAFF see a private release the requester path hides", async () => {
    const repo = repoWith();
    await seedAnswered(repo, {
      ask: "street cleaning schedules for downtown",
      visibility: "private",
      classification: "internal",
    });

    const staff = await findPriorAnswers({ repo }, {
      agencyId: AG,
      ask: "street cleaning schedules downtown",
      audience: "staff",
    });
    expect(staff.considered).toBe(1);
  });

  it("ignores requests that released nothing", async () => {
    const repo = repoWith();
    // Denied: a determination, not a release. It can answer nothing.
    await seedAnswered(repo, {
      ask: "street cleaning schedules for downtown",
      visibility: "public",
      classification: "public",
      status: "denied",
    });

    const r = await findPriorAnswers({ repo }, {
      agencyId: AG,
      ask: "street cleaning schedules downtown",
      audience: "requester",
    });
    expect(r.considered).toBe(0);
  });
});

describe("findPriorAnswers — degradation", () => {
  it("works with no model configured, and says the result is unjudged", async () => {
    const repo = repoWith();
    await seedAnswered(repo, {
      ask: "street cleaning schedules for downtown",
      visibility: "public",
      classification: "public",
      title: "Street cleaning schedule, Q2",
    });

    const r = await findPriorAnswers({ repo }, {
      agencyId: AG,
      ask: "when do the street sweepers come downtown",
      audience: "requester",
    });

    // BM25 still connects "street"/"downtown"; the result is honest about
    // not having been checked.
    expect(r.judged).toBe(false);
    expect(r.indexKind).toBe("builtin");
    expect(r.matches[0]?.confidence).toBe(0);
    expect(r.matches[0]?.rationale).toMatch(/not yet checked/i);
  });

  it("returns nothing for an ask too short to mean anything", async () => {
    const repo = repoWith();
    await seedAnswered(repo, {
      ask: "street cleaning schedules",
      visibility: "public",
      classification: "public",
    });
    const r = await findPriorAnswers({ repo }, { agencyId: AG, ask: "docs", audience: "requester" });
    expect(r.matches).toEqual([]);
  });

  it("survives a model failure without blocking the caller", async () => {
    const repo = repoWith();
    await seedAnswered(repo, {
      ask: "street cleaning schedules for downtown",
      visibility: "public",
      classification: "public",
    });
    const exploding = new FakeModelClient([new Error("model down"), new Error("model down"), new Error("model down")]);

    const r = await findPriorAnswers({ repo }, {
      agencyId: AG,
      ask: "street cleaning schedules downtown",
      audience: "requester",
      modelClient: exploding,
    });
    // Filing must still be possible — a matcher failure is not a blocker.
    expect(r.matches).toEqual([]);
  });
});

describe("findPriorAnswers — judging", () => {
  it("surfaces a confident match with its documents and rationale", async () => {
    const repo = repoWith();
    const seeded = await seedAnswered(repo, {
      ask: "street cleaning schedules for downtown",
      visibility: "public",
      classification: "public",
      title: "Street cleaning schedule, Q2",
    });

    const r = await findPriorAnswers({ repo }, {
      agencyId: AG,
      ask: "when do the street sweepers come downtown",
      audience: "requester",
      modelClient: judge([
        {
          publicId: seeded.publicId,
          coverage: "full",
          confidence: 0.91,
          rationale: "The Q2 schedule covers downtown sweeping.",
        },
      ]),
    });

    expect(r.judged).toBe(true);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]!.coverage).toBe("full");
    expect(r.matches[0]!.documents[0]!.title).toBe("Street cleaning schedule, Q2");
    expect(r.matches[0]!.rationale).toMatch(/downtown/i);
  });

  it("drops a match below the requester floor but keeps it for staff", async () => {
    const seedFor = async (audience: "requester" | "staff") => {
      const repo = repoWith();
      const seeded = await seedAnswered(repo, {
        ask: "street cleaning schedules for downtown",
        visibility: "public",
        classification: "public",
      });
      return findPriorAnswers({ repo }, {
        agencyId: AG,
        ask: "street sweeping downtown",
        audience,
        // 0.5 sits between STAFF_MATCH_FLOOR (0.45) and REQUESTER_MATCH_FLOOR (0.72).
        modelClient: judge([
          { publicId: seeded.publicId, coverage: "partial", confidence: 0.5, rationale: "maybe" },
        ]),
      });
    };

    // Telling a resident "you already have your answer" when we are half sure
    // costs them a request they never file. Staff can act on a hint.
    expect((await seedFor("requester")).matches).toEqual([]);
    expect((await seedFor("staff")).matches).toHaveLength(1);
  });

  it("discards a publicId the model invented", async () => {
    const repo = repoWith();
    await seedAnswered(repo, {
      ask: "street cleaning schedules for downtown",
      visibility: "public",
      classification: "public",
    });

    const r = await findPriorAnswers({ repo }, {
      agencyId: AG,
      ask: "street sweeping downtown",
      audience: "requester",
      modelClient: judge([
        { publicId: "PR-DOES-NOT-EXIST", coverage: "full", confidence: 0.99, rationale: "nope" },
      ]),
    });
    // A hallucinated id must never reach a resident as a real record.
    expect(r.matches).toEqual([]);
  });
});
