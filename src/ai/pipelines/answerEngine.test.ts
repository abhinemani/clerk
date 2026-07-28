/** Tests for the grounded answer engine (spec §6.7). */
import { describe, expect, it } from "vitest";
import { DEMO_CORPUS } from "@/lib/corpus";
import { LexicalRetriever } from "../search/retriever";
import { FakeModelClient } from "../modelClient";
import { answerEngineSchema, answerQuestion, type AnswerEngineOutput } from "./answerEngine";

const retriever = new LexicalRetriever(DEMO_CORPUS);

const grounded: AnswerEngineOutput = {
  answered: true,
  answer: "The Riverton–Acme paving contract from 2025 is public — here it is.",
  citations: ["d-paving"],
  suggestedRequestScope: null,
};
const punt: AnswerEngineOutput = {
  answered: false,
  answer: null,
  citations: [],
  suggestedRequestScope: "Officer Smith disciplinary records, last 3 years",
};

describe("schema", () => {
  it("accepts grounded and punt shapes, rejects extras", () => {
    expect(answerEngineSchema.safeParse(grounded).success).toBe(true);
    expect(answerEngineSchema.safeParse(punt).success).toBe(true);
    expect(answerEngineSchema.safeParse({ ...grounded, extra: 1 }).success).toBe(false);
  });
});

describe("answerQuestion", () => {
  const opts = (script: unknown[]) => ({
    retriever,
    pipelineOpts: { modelClient: new FakeModelClient(script) },
  });

  it("answers from a public document and validates the citation", async () => {
    const res = await answerQuestion(opts([grounded]), "the acme paving contract");
    expect(res.output.answered).toBe(true);
    expect(res.output.citations).toEqual(["d-paving"]);
    expect(res.citedTitles[0]).toContain("Paving");
  });

  it("punts (no fabrication) when only internal records would answer", async () => {
    // The public retriever finds nothing → the model is asked over an empty set → punts.
    const res = await answerQuestion(opts([punt]), "officer smith disciplinary personnel file");
    expect(res.output.answered).toBe(false);
    expect(res.output.answer).toBeNull();
    expect(res.output.suggestedRequestScope).toBeTruthy();
  });

  it("drops a hallucinated citation and downgrades to a punt", async () => {
    const hallucinated: AnswerEngineOutput = { ...grounded, citations: ["d-DOES-NOT-EXIST"] };
    const res = await answerQuestion(opts([hallucinated]), "the acme paving contract");
    expect(res.droppedCitations).toContain("d-DOES-NOT-EXIST");
    expect(res.output.answered).toBe(false); // no valid citation → not grounded → punt
  });

  it("can never cite an internal document (never provided to the model)", async () => {
    // Even if the model tries to cite an internal id, retrieval never surfaced it.
    const sneaky: AnswerEngineOutput = { ...grounded, citations: ["d-legal-memo"] };
    const res = await answerQuestion(opts([sneaky]), "pending litigation 400 main");
    expect(res.output.citations).not.toContain("d-legal-memo");
    expect(res.output.answered).toBe(false);
  });
});
