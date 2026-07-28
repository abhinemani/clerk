/** Tests for hybrid search (§6.4) and duplicate detection (§6.2). */
import { describe, expect, it } from "vitest";
import { DEMO_CORPUS } from "@/lib/corpus";
import { FakeEmbeddingProvider } from "./embeddings";
import { HybridRetriever } from "./hybrid";
import { findDuplicates, type RequestLike } from "../dedup/duplicates";

const embedder = new FakeEmbeddingProvider();
const hybrid = new HybridRetriever(DEMO_CORPUS, embedder);

describe("HybridRetriever", () => {
  it("fuses lexical + vector and surfaces the right public doc", async () => {
    const hits = await hybrid.search("acme paving street contract", { scope: "public" });
    expect(hits[0]!.id).toBe("d-paving");
    expect(hits.every((c) => c.classification === "public")).toBe(true);
  });

  it("still never returns an internal doc on a public search", async () => {
    for (const q of ["officer smith personnel disciplinary", "attorney litigation memo"]) {
      const hits = await hybrid.search(q, { scope: "public" });
      expect(hits.every((c) => c.classification === "public")).toBe(true);
    }
  });

  it("full scope can see internal docs (staff side)", async () => {
    const hits = await hybrid.search("officer smith personnel", { scope: "full" });
    expect(hits.some((c) => c.id === "d-personnel")).toBe(true);
  });
});

describe("findDuplicates", () => {
  const existing: RequestLike[] = [
    { id: "1", publicId: "PR-2026-00341", text: "All inspection reports for 400 Main St from 2024 to present" },
    { id: "2", publicId: "PR-2026-00300", text: "The current janitorial services contract for City Hall" },
  ];

  it("flags a near-duplicate request (lexical)", async () => {
    const dups = await findDuplicates(
      "inspection reports for 400 Main St from January 2024 to present please",
      existing,
      { threshold: 0.3 },
    );
    expect(dups[0]!.publicId).toBe("PR-2026-00341");
    expect(dups[0]!.similarity).toBeGreaterThan(0.3);
  });

  it("returns nothing for an unrelated request", async () => {
    const dups = await findDuplicates("body camera footage from the July 4 parade", existing, { threshold: 0.3 });
    expect(dups).toEqual([]);
  });

  it("works with an embedding provider too", async () => {
    const dups = await findDuplicates(
      "inspection reports 400 Main Street 2024",
      existing,
      { threshold: 0.2, embedder },
    );
    expect(dups.some((d) => d.publicId === "PR-2026-00341")).toBe(true);
  });
});
