import { describe, expect, it } from "vitest";
import {
  describeAvailability,
  demoRequestEmail,
  parseDemoRequest,
  type DemoRequestInput,
} from "./demoRequest";

const base: DemoRequestInput = {
  name: "  Dana  Okafor ",
  email: "Dana@CityOfAlto.org",
  organization: "City of Alto",
  role: "City Clerk",
  stateCode: "ca",
  days: ["tue", "thu"],
  windows: ["morning"],
  timezone: "PT",
  note: "  We're on a 2026 renewal cycle.  ",
};

describe("parseDemoRequest", () => {
  it("normalizes a good submission", () => {
    const r = parseDemoRequest(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe("Dana Okafor"); // collapsed whitespace
    expect(r.value.email).toBe("dana@cityofalto.org"); // lowercased
    expect(r.value.stateCode).toBe("CA");
    expect(r.value.note).toBe("We're on a 2026 renewal cycle.");
  });

  it("keeps day/window order canonical and drops unknown values", () => {
    const r = parseDemoRequest({
      ...base,
      days: ["fri", "bogus", "mon", "mon"],
      windows: ["afternoon", "morning"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.days).toEqual(["mon", "fri"]);
    expect(r.value.windows).toEqual(["morning", "afternoon"]);
  });

  it("treats optional fields as absent rather than empty strings", () => {
    const r = parseDemoRequest({ ...base, role: "  ", stateCode: "", note: "   " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.role).toBeNull();
    expect(r.value.stateCode).toBeNull();
    expect(r.value.note).toBeNull();
  });

  it("ignores a state code that isn't two letters", () => {
    const r = parseDemoRequest({ ...base, stateCode: "California" });
    expect(r.ok && r.value.stateCode).toBeNull();
  });

  it.each([
    ["missing name", { name: "" }],
    ["missing organization", { organization: " " }],
    ["bad email", { email: "dana@cityofalto" }],
    ["no days", { days: [] }],
    ["no windows", { windows: [] }],
    ["unknown days only", { days: ["someday"] }],
    ["bad timezone", { timezone: "Mars/Olympus" }],
    ["overlong note", { note: "x".repeat(1001) }],
    ["overlong name", { name: "x".repeat(121) }],
  ])("refuses: %s", (_label, patch) => {
    const r = parseDemoRequest({ ...base, ...(patch as Partial<DemoRequestInput>) });
    expect(r.ok).toBe(false);
    // Every refusal is a sentence a person can act on, not a field code.
    if (!r.ok) expect(r.error.length).toBeGreaterThan(10);
  });
});

describe("describeAvailability", () => {
  it("reads as one operator-facing line", () => {
    expect(
      describeAvailability({ days: ["thu", "tue"], windows: ["afternoon"], timezone: "PT" }),
    ).toBe("Tue, Thu · afternoon · Pacific");
  });

  it("falls back to the raw zone when it isn't one of ours", () => {
    expect(describeAvailability({ days: ["mon"], windows: ["midday"], timezone: "CET" })).toBe(
      "Mon · midday · CET",
    );
  });
});

describe("demoRequestEmail", () => {
  it("carries who, where, and when in a plain-text body", () => {
    const parsed = parseDemoRequest(base);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const mail = demoRequestEmail(parsed.value);
    expect(mail.subject).toBe("Walkthrough request — City of Alto");
    expect(mail.text).toContain("Dana Okafor, City Clerk");
    expect(mail.text).toContain("City of Alto (CA)");
    expect(mail.text).toContain("dana@cityofalto.org");
    expect(mail.text).toContain("Available: Tue, Thu · morning · Pacific");
    expect(mail.text).toContain("We're on a 2026 renewal cycle.");
  });
});
