import { describe, expect, it } from "vitest";
import { addAskAlias, MAX_ASK_ALIASES } from "./documentMeta";

describe("addAskAlias", () => {
  it("records the first ask", () => {
    expect(addAskAlias({}, "street cleaning schedules")).toEqual(["street cleaning schedules"]);
  });

  it("de-duplicates case- and whitespace-insensitively", () => {
    const meta = { askedAs: ["street cleaning schedules"] };
    // Ten residents asking the same thing should leave one alias, not ten.
    expect(addAskAlias(meta, "Street Cleaning Schedules")).toBeNull();
    expect(addAskAlias(meta, "  street   cleaning   schedules ")).toBeNull();
  });

  it("keeps genuinely different phrasings — that IS the asset", () => {
    const meta = { askedAs: ["street cleaning schedules"] };
    expect(addAskAlias(meta, "when do the sweepers come down my block")).toEqual([
      "street cleaning schedules",
      "when do the sweepers come down my block",
    ]);
  });

  it("ignores asks too short to teach anything", () => {
    expect(addAskAlias({}, "records")).toBeNull();
    expect(addAskAlias({}, "   ")).toBeNull();
  });

  it("caps growth, dropping the oldest first", () => {
    const askedAs = Array.from({ length: MAX_ASK_ALIASES }, (_, i) => `distinct question ${i}`);
    const next = addAskAlias({ askedAs }, "a brand new phrasing entirely")!;
    expect(next).toHaveLength(MAX_ASK_ALIASES);
    expect(next.at(-1)).toBe("a brand new phrasing entirely");
    expect(next).not.toContain("distinct question 0");
  });
});
