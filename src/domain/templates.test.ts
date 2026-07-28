/** Tests for merge-field template rendering (spec §5, §6.6). */
import { describe, expect, it } from "vitest";
import { renderTemplate, templateFields } from "./templates";

describe("renderTemplate", () => {
  const ctx = {
    requester: { name: "Jane Doe" },
    request: { public_id: "PR-2026-00341", due: "2026-08-10" },
    agency: { name: "City of Riverton" },
  };

  it("substitutes dotted-path merge fields", () => {
    const out = renderTemplate(
      "Dear {{requester.name}}, your request {{request.public_id}} is due {{request.due}}.",
      ctx,
    );
    expect(out.text).toBe("Dear Jane Doe, your request PR-2026-00341 is due 2026-08-10.");
    expect(out.missing).toEqual([]);
  });

  it("tolerates whitespace inside braces", () => {
    expect(renderTemplate("Hi {{ requester.name }}", ctx).text).toBe("Hi Jane Doe");
  });

  it("reports missing fields and renders them empty (never leaves {{...}})", () => {
    const out = renderTemplate("Fee: {{fee.total}} for {{requester.name}}", ctx);
    expect(out.text).toBe("Fee:  for Jane Doe");
    expect(out.missing).toEqual(["fee.total"]);
    expect(out.text).not.toContain("{{");
  });

  it("treats empty-string values as missing", () => {
    const out = renderTemplate("X{{a}}Y", { a: "" });
    expect(out.missing).toEqual(["a"]);
  });

  it("de-duplicates repeated missing fields", () => {
    const out = renderTemplate("{{x}} {{x}}", {});
    expect(out.missing).toEqual(["x"]);
  });
});

describe("templateFields", () => {
  it("lists distinct field paths", () => {
    expect(templateFields("{{a}} {{b.c}} {{a}}")).toEqual(["a", "b.c"]);
  });
});
