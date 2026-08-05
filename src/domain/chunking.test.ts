/** Chunking for embeddings (§6.4) — overlap without runaway growth. */
import { describe, expect, it } from "vitest";
import { chunkText, MAX_CHUNKS_PER_DOC } from "./chunking";

describe("chunkText", () => {
  it("returns one chunk for a short document", () => {
    const chunks = chunkText("line one\nline two\nline three");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain("line one");
    expect(chunks[0]!.startLine).toBe(0);
  });

  it("splits a long document and overlaps adjacent chunks for context", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `Line ${i} ${"x".repeat(40)}`);
    const chunks = chunkText(lines.join("\n"), 400, 2);
    expect(chunks.length).toBeGreaterThan(1);
    // Overlap: each chunk starts before the previous one ended.
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.startLine).toBeLessThanOrEqual(chunks[i - 1]!.endLine);
    }
    // Coverage: every line appears somewhere.
    const joined = chunks.map((c) => c.content).join("\n");
    expect(joined).toContain("Line 0 ");
    expect(joined).toContain("Line 59 ");
  });

  it("always makes progress on a pathologically long single line", () => {
    const chunks = chunkText("y".repeat(10_000), 200);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content.length).toBe(10_000);
  });

  it("skips blank content and handles an empty document", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("\n\n\n")).toEqual([]);
  });

  it("caps chunk count so one document can't flood the corpus", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `Line ${i} ${"z".repeat(80)}`);
    expect(chunkText(lines.join("\n"), 100, 1).length).toBeLessThanOrEqual(MAX_CHUNKS_PER_DOC);
  });
});
