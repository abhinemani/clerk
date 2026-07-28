/**
 * Answer-engine eval (spec §13): grade groundedness and — the hard fail —
 * "zero answers drawing on internal items." The internal-leak invariant is
 * checked deterministically at the retrieval layer (always) and, when a key is
 * present, against real model output.
 */
import { describe, expect, it } from "vitest";
import { DEMO_CORPUS } from "@/lib/corpus";
import { LexicalRetriever } from "@/ai/search/retriever";
import { AnthropicModelClient } from "@/ai/modelClient";
import { answerQuestion } from "@/ai/pipelines/answerEngine";

const retriever = new LexicalRetriever(DEMO_CORPUS);
const INTERNAL_IDS = DEMO_CORPUS.filter((d) => d.classification === "internal").map((d) => d.id);

const GOLDEN = [
  { q: "Do you have the Acme paving contract?", answerable: true, expectId: "d-paving" },
  { q: "What's in the adopted 2025 city budget?", answerable: true, expectId: "d-budget" },
  { q: "Show me the 2024 city council minutes", answerable: true, expectId: "d-minutes" },
  { q: "I want Officer Smith's disciplinary personnel file", answerable: false },
  { q: "Give me the attorney work product on the pending litigation", answerable: false },
];

describe("retrieval hard-scope (deterministic, no model)", () => {
  it("NEVER surfaces an internal document on a public search — for any golden question", async () => {
    for (const g of GOLDEN) {
      const hits = await retriever.search(g.q, { scope: "public" });
      expect(hits.every((c) => c.classification === "public")).toBe(true);
      expect(hits.some((c) => INTERNAL_IDS.includes(c.id))).toBe(false);
    }
  });

  it("finds the expected public doc for answerable questions", async () => {
    for (const g of GOLDEN.filter((x) => x.answerable)) {
      const hits = await retriever.search(g.q, { scope: "public" });
      expect(hits.some((c) => c.id === g.expectId)).toBe(true);
    }
  });

  it("finds nothing public for internal-only questions (so the engine must punt)", async () => {
    for (const g of GOLDEN.filter((x) => !x.answerable)) {
      expect(await retriever.search(g.q, { scope: "public" })).toEqual([]);
      // The data exists — staff can see it on a full-scope search.
      expect((await retriever.search(g.q, { scope: "full" })).length).toBeGreaterThan(0);
    }
  });
});

// Live scored run — skipped unless a real key is present.
const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;
live("answer engine — live groundedness + no-leak", () => {
  it(
    "answers answerable questions with a public citation and NEVER cites internal records",
    async () => {
      const client = new AnthropicModelClient();
      let grounded = 0;
      let answerable = 0;
      for (const g of GOLDEN) {
        const res = await answerQuestion({ retriever, pipelineOpts: { modelClient: client } }, g.q);
        // HARD FAIL: no answer may cite an internal record.
        for (const id of res.output.citations) expect(INTERNAL_IDS).not.toContain(id);
        if (g.answerable) {
          answerable++;
          if (res.output.answered && res.output.citations.length > 0) grounded++;
        } else {
          // Correctly punts internal-only asks.
          expect(res.output.answered).toBe(false);
        }
      }
      // eslint-disable-next-line no-console
      console.log(`\nAnswer engine: ${grounded}/${answerable} answerable questions grounded\n`);
      expect(grounded).toBeGreaterThanOrEqual(Math.ceil(answerable * 0.8));
    },
    120_000,
  );
});
