/**
 * Precedent retrieval (answer-first phase 4): only human-reviewed requests
 * teach; vectors rank when stored, token overlap carries the rest; the
 * request being triaged never cites itself; and a provider outage degrades
 * to lexical instead of failing intake.
 */
import { describe, expect, it } from "vitest";
import { FakeEmbeddingProvider, type EmbeddingProvider } from "@/ai/search/embeddings";
import type { ServiceDeps } from "./deps";
import { InMemoryRepository, type Agency, type RequestEntity } from "./repository";
import {
  findResolvedPrecedents,
  requestEmbeddingText,
  writeRequestEmbedding,
} from "./similarRequestsService";

const AGENCY: Agency = { id: "ag-1", slug: "riverton", name: "Riverton", stateCode: "CA", observedHolidays: [] };

function ctx() {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-08-13T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
  };
  return { repo, deps };
}

function requestOf(over: Partial<RequestEntity>): RequestEntity {
  return {
    id: over.id ?? crypto.randomUUID(),
    agencyId: "ag-1",
    publicId: over.publicId ?? `PR-2026-${Math.floor(Math.random() * 89999) + 10000}`,
    requesterId: null,
    status: "in_progress",
    rawText: "records",
    interpretedScope: null,
    recordTypes: [],
    complexityScore: null,
    receivedAt: new Date("2026-06-01T00:00:00Z"),
    statutoryDueAt: null,
    closedAt: null,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    ...over,
  };
}

const embedder = new FakeEmbeddingProvider(96);

async function seedCorpus(deps: ServiceDeps) {
  const { repo } = deps;
  const sweeping = await repo.createRequest(
    requestOf({
      publicId: "PR-2026-00001",
      rawText: "When are the street sweeping days for the Riverbend neighborhood this year?",
      interpretedScope: "Street sweeping schedule for Riverbend, current year.",
      recordTypes: ["schedules"],
      complexityScore: 0.15,
      status: "closed",
      closedAt: new Date("2026-07-01T00:00:00Z"),
    }),
  );
  const dept = await repo.createDepartment({ id: "d-pw", agencyId: "ag-1", name: "Public Works", defaultResponderEmails: [] });
  await repo.createTask({
    id: "t-1",
    agencyId: "ag-1",
    requestId: sweeping.id,
    departmentId: dept.id,
    scopeText: "Pull the sweeping schedule",
    status: "done",
    token: "tok-sweeping",
    dueAt: null,
    uploads: [],
    pushbackNotes: null,
  });
  const contracts = await repo.createRequest(
    requestOf({
      publicId: "PR-2026-00002",
      rawText: "All janitorial service contracts for city buildings since 2024.",
      interpretedScope: "Janitorial services contracts, 2024–present.",
      recordTypes: ["contracts"],
      complexityScore: 0.4,
    }),
  );
  // Untriaged — has nothing to teach a triage prompt, must never appear.
  const untriaged = await repo.createRequest(
    requestOf({ publicId: "PR-2026-00003", rawText: "street sweeping records please", interpretedScope: null }),
  );
  for (const r of [sweeping, contracts, untriaged]) {
    await writeRequestEmbedding(deps, { agencyId: "ag-1", requestId: r.id }, embedder);
  }
  return { sweeping, contracts, untriaged };
}

describe("writeRequestEmbedding", () => {
  it("stores a vector; provider failure is non-fatal and returns false", async () => {
    const { repo, deps } = ctx();
    const r = await repo.createRequest(requestOf({ rawText: "park maintenance invoices" }));
    expect(await writeRequestEmbedding(deps, { agencyId: "ag-1", requestId: r.id }, embedder)).toBe(true);
    expect((await repo.listRequestEmbeddings("ag-1")).map((e) => e.id)).toContain(r.id);

    const broken: EmbeddingProvider = { embed: async () => { throw new Error("provider down"); } };
    const r2 = await repo.createRequest(requestOf({}));
    expect(await writeRequestEmbedding(deps, { agencyId: "ag-1", requestId: r2.id }, broken)).toBe(false);
  });

  it("embeds raw text first, human scope appended when present", () => {
    expect(requestEmbeddingText({ rawText: "raw ask", interpretedScope: "clean scope" })).toBe("raw ask\nclean scope");
    expect(requestEmbeddingText({ rawText: "raw ask", interpretedScope: null })).toBe("raw ask");
  });
});

describe("findResolvedPrecedents", () => {
  it("ranks the vocabulary-matching resolved request first, with its outcome and departments", async () => {
    const { deps } = ctx();
    await seedCorpus(deps);
    const hits = await findResolvedPrecedents(
      deps,
      { agencyId: "ag-1", text: "what days does the street sweeper come to Riverbend?" },
      embedder,
    );
    expect(hits[0]!.publicId).toBe("PR-2026-00001");
    expect(hits[0]!.outcome).toBe("closed");
    expect(hits[0]!.departments).toEqual(["Public Works"]);
    expect(hits[0]!.interpretedScope).toContain("sweeping");
    // The untriaged request shares vocabulary but taught no one anything.
    expect(hits.map((h) => h.publicId)).not.toContain("PR-2026-00003");
  });

  it("excludes the request being triaged from its own precedents", async () => {
    const { deps } = ctx();
    const { sweeping } = await seedCorpus(deps);
    const hits = await findResolvedPrecedents(
      deps,
      { agencyId: "ag-1", text: sweeping.rawText, excludeRequestId: sweeping.id },
      embedder,
    );
    expect(hits.map((h) => h.publicId)).not.toContain("PR-2026-00001");
  });

  it("degrades to token overlap when the embed call fails — intake never starves", async () => {
    const { deps } = ctx();
    await seedCorpus(deps);
    const broken: EmbeddingProvider = { embed: async () => { throw new Error("provider down"); } };
    const hits = await findResolvedPrecedents(
      deps,
      { agencyId: "ag-1", text: "street sweeping schedule for Riverbend" },
      broken,
    );
    expect(hits[0]!.publicId).toBe("PR-2026-00001");
  });

  it("returns nothing for an unrelated ask instead of forcing bad precedents", async () => {
    const { deps } = ctx();
    await seedCorpus(deps);
    const hits = await findResolvedPrecedents(
      deps,
      { agencyId: "ag-1", text: "zzqx unrelated bodycam telemetry export" },
      embedder,
    );
    expect(hits.filter((h) => h.similarity > 0.5)).toEqual([]);
  });
});
