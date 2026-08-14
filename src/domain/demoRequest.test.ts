import { describe, expect, it } from "vitest";
import {
  isHoneypotRejection,
  looksLikeEmail,
  schedulingUrl,
  validateDemoRequest,
} from "./demoRequest";

const base = {
  name: "Dana Clerk",
  email: "Dana.Clerk@Example.ORG",
  organization: "City of Example",
};

describe("looksLikeEmail", () => {
  it("accepts ordinary addresses, government and not", () => {
    for (const e of ["clerk@city.gov", "d@ci.springfield.il.us", "someone@gmail.com"]) {
      expect(looksLikeEmail(e)).toBe(true);
    }
  });

  it("rejects the shapes that are never deliverable", () => {
    for (const e of ["", "clerk", "clerk@", "@city.gov", "clerk@city", "a b@city.gov", "clerk@.gov"]) {
      expect(looksLikeEmail(e)).toBe(false);
    }
  });
});

describe("validateDemoRequest", () => {
  it("normalizes: trims, lowercases the email, nulls the empty optionals", () => {
    const r = validateDemoRequest({ ...base, name: "  Dana Clerk  ", role: "  ", notes: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe("Dana Clerk");
    expect(r.value.email).toBe("dana.clerk@example.org");
    expect(r.value.role).toBeNull();
    expect(r.value.notes).toBeNull();
  });

  it("requires only name, email, and organization", () => {
    expect(validateDemoRequest(base).ok).toBe(true);
    expect(validateDemoRequest({ ...base, name: "" }).ok).toBe(false);
    expect(validateDemoRequest({ ...base, email: "nope" }).ok).toBe(false);
    expect(validateDemoRequest({ ...base, organization: "" }).ok).toBe(false);
  });

  it("does not gate on government email (signupPolicy's lesson)", () => {
    const r = validateDemoRequest({ ...base, email: "records.officer@gmail.com" });
    expect(r.ok).toBe(true);
  });

  it("keeps a two-letter state, drops anything else", () => {
    const ca = validateDemoRequest({ ...base, stateCode: "ca" });
    expect(ca.ok && ca.value.stateCode).toBe("CA");
    for (const bad of ["", "California", "1"]) {
      const r = validateDemoRequest({ ...base, stateCode: bad });
      expect(r.ok && r.value.stateCode).toBeNull();
    }
  });

  it("bounds every field so a paste bomb can't reach the database", () => {
    const r = validateDemoRequest({
      ...base,
      name: "n".repeat(500),
      organization: "o".repeat(500),
      notes: "x".repeat(9000),
      source: "s".repeat(500),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name.length).toBe(120);
    expect(r.value.organization.length).toBe(160);
    expect(r.value.notes?.length).toBe(2000);
    expect(r.value.source?.length).toBe(60);
  });

  it("rejects a filled honeypot, distinguishably from a user error", () => {
    const bot = validateDemoRequest({ ...base, honeypot: "http://spam" });
    expect(bot.ok).toBe(false);
    expect(isHoneypotRejection(bot)).toBe(true);

    const human = validateDemoRequest({ ...base, email: "nope" });
    expect(isHoneypotRejection(human)).toBe(false);
  });
});

describe("schedulingUrl", () => {
  it("is null by default — the built-in form is the real path", () => {
    expect(schedulingUrl({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(schedulingUrl({ DEMO_SCHEDULING_URL: "  " } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("returns an absolute http(s) scheduler", () => {
    expect(schedulingUrl({ DEMO_SCHEDULING_URL: "https://cal.com/brandeis" } as unknown as NodeJS.ProcessEnv)).toBe(
      "https://cal.com/brandeis",
    );
  });

  it("refuses non-http schemes and relative values (redirect gadget on a public page)", () => {
    for (const bad of ["javascript:alert(1)", "/admin", "//evil.example"]) {
      expect(schedulingUrl({ DEMO_SCHEDULING_URL: bad } as unknown as NodeJS.ProcessEnv)).toBeNull();
    }
  });
});
