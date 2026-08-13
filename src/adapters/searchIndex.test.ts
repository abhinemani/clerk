import { describe, expect, it } from "vitest";
import { BuiltinSearchIndex, ElasticSearchIndex, type IndexedDoc } from "./searchIndex";

const idx = new BuiltinSearchIndex();

function doc(id: string, title: string, text: string, askedAs: string[] = []): IndexedDoc {
  return { id, title, text, askedAs, classification: "public" };
}

describe("BuiltinSearchIndex (BM25)", () => {
  it("prefers the document that is ABOUT the term over one that merely mentions it", async () => {
    // The old scoring was "+1 if the term appears anywhere", which ranked
    // these equal. Length normalisation is the whole point of the upgrade.
    const corpus = [
      doc("short", "Acme Paving Contract", "Executed paving contract with Acme."),
      doc(
        "long",
        "Council minutes, March",
        "Minutes covering many topics. " +
          "The council discussed parks, libraries, transit, zoning, budgets, and staffing. ".repeat(12) +
          "A paving contract was mentioned once.",
      ),
    ];
    const hits = await idx.search("paving contract", corpus);
    expect(hits[0]!.id).toBe("short");
  });

  it("saturates term frequency instead of rewarding repetition", async () => {
    const corpus = [
      doc("stuffed", "Records", "paving ".repeat(80)),
      doc("real", "Acme Paving Contract 2025", "Executed paving contract with Acme Paving Co."),
    ];
    const hits = await idx.search("paving contract", corpus);
    // Keyword stuffing must not beat a genuine match on two terms.
    expect(hits[0]!.id).toBe("real");
  });

  it("weights rare terms above common ones", async () => {
    const corpus = [
      doc("a", "Contract A", "contract records"),
      doc("b", "Contract B", "contract records"),
      doc("c", "Contract C", "contract records zoning variance"),
    ];
    const hits = await idx.search("contract zoning", corpus);
    // "zoning" appears once across the corpus; "contract" in all three.
    expect(hits[0]!.id).toBe("c");
  });

  it("finds a record through an ask alias it would otherwise miss", async () => {
    const corpus = [
      doc(
        "sweep",
        "Axon Route Log 2025-0714-A",
        "Route log export.",
        ["when do the street sweepers come down my block"],
      ),
      doc("other", "Budget appendix", "Fiscal appendix tables."),
    ];
    // Nothing in the title or text says "sweepers" — only the prior ask does.
    const hits = await idx.search("street sweepers schedule", corpus);
    expect(hits[0]!.id).toBe("sweep");
    expect(hits[0]!.viaAlias).toBe(true);
    expect(hits[0]!.why).toMatch(/earlier request/i);
  });

  it("does not claim an alias match when the body already matched", async () => {
    const corpus = [doc("d", "Street sweeping schedule", "street sweeping", ["street sweeping"])];
    const hits = await idx.search("street sweeping", corpus);
    expect(hits[0]!.viaAlias).toBe(false);
  });

  it("returns nothing for stopword-only queries and empty corpora", async () => {
    expect(await idx.search("the and for", [doc("a", "A", "b")])).toEqual([]);
    expect(await idx.search("paving", [])).toEqual([]);
  });
});

describe("ElasticSearchIndex", () => {
  const corpus = [doc("a", "Acme Paving Contract", "paving"), doc("b", "Other", "unrelated")];

  it("falls back to builtin when the cluster is unreachable", async () => {
    const es = new ElasticSearchIndex("http://127.0.0.1:1", "records", idx);
    const hits = await es.search("paving contract", corpus);
    // A cluster being down must never stop a resident finding a public record.
    expect(hits[0]!.id).toBe("a");
  });

  it("never widens the result set beyond the corpus it was given", async () => {
    // A stale or over-broad cluster index must not become a disclosure path:
    // the corpus is the authority on what this audience may see.
    const fetchMock = async () =>
      new Response(
        JSON.stringify({ hits: { hits: [{ _id: "leaked-internal-doc", _score: 9 }, { _id: "a", _score: 2 }] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const es = new ElasticSearchIndex("http://es.test", "records", idx);
      const hits = await es.search("paving", corpus);
      expect(hits.map((h) => h.id)).toEqual(["a"]);
    } finally {
      globalThis.fetch = original;
    }
  });
});
