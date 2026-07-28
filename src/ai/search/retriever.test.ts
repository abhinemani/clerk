/** Tests for responsive-records search + public-scope enforcement (§6.4, §6.7). */
import { describe, expect, it } from "vitest";
import { DEMO_CORPUS } from "@/lib/corpus";
import {
  assertPublicOnly,
  InternalLeakError,
  LexicalRetriever,
  type Candidate,
} from "./retriever";

const retriever = new LexicalRetriever(DEMO_CORPUS);

describe("LexicalRetriever — scoping", () => {
  it("returns matching PUBLIC docs with a why-matched rationale", async () => {
    const hits = await retriever.search("acme paving contract", { scope: "public" });
    expect(hits[0]!.id).toBe("d-paving");
    expect(hits[0]!.classification).toBe("public");
    expect(hits[0]!.whyMatched.toLowerCase()).toContain("paving");
    expect(hits[0]!.deepLink).toBeTruthy();
  });

  it("NEVER returns internal docs on a public search (the hard rule)", async () => {
    const hits = await retriever.search("officer smith personnel disciplinary", { scope: "public" });
    expect(hits).toEqual([]);
    // And no result across any public query is internal.
    for (const q of ["budget", "minutes", "legal memo litigation", "smith"]) {
      const r = await retriever.search(q, { scope: "public" });
      expect(r.every((c) => c.classification === "public")).toBe(true);
    }
  });

  it("staff full-scope search CAN see internal docs", async () => {
    const hits = await retriever.search("officer smith personnel", { scope: "full" });
    expect(hits.some((c) => c.id === "d-personnel")).toBe(true);
  });

  it("ranks title matches above body matches", async () => {
    const hits = await retriever.search("budget", { scope: "public" });
    expect(hits[0]!.id).toBe("d-budget"); // title hit outranks the minutes body mention
  });

  it("filters by record type", async () => {
    const hits = await retriever.search("2025", { scope: "public", recordType: "contract" });
    expect(hits.every((c) => c.recordType === "contract")).toBe(true);
  });
});

describe("assertPublicOnly", () => {
  it("throws if an internal doc slips into a public result set", () => {
    const bad: Candidate[] = [
      { id: "x", title: "t", score: 1, whyMatched: "", classification: "internal", snippet: "" },
    ];
    expect(() => assertPublicOnly(bad)).toThrow(InternalLeakError);
  });
});
