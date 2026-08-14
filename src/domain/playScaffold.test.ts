import { describe, expect, it } from "vitest";
import { composePlayScaffold, type PlayScaffoldInput } from "./playScaffold";

const base: PlayScaffoldInput = {
  play: {
    topic: "towing contracts",
    episodeCount: 12,
    stats: {
      routes: [{ departmentId: "d-pw", department: "Public Works", share: 0.83 }],
      exemptions: [{ label: "Bank details (trade secrets)", count: 4 }],
      outcomes: { fulfilled: 10, partially_fulfilled: 2 },
      medianDaysToClose: 6,
      extensionRate: 0.08,
      samplePublicIds: ["PR-2026-00001"],
    },
  },
  publicId: "PR-2026-00042",
  agencyName: "City of Riverton",
  requesterName: "Dana Whitfield",
  rawText: "All towing contracts signed in 2025.",
  statutoryDueDate: "Mon Aug 24 2026",
};

describe("composePlayScaffold", () => {
  it("grounds the letter in the play's history", () => {
    const { subject, body } = composePlayScaffold(base);
    expect(subject).toBe("Your records request PR-2026-00042 — status and next step");
    expect(body).toContain("Hi Dana,");
    expect(body).toContain('"All towing contracts signed in 2025."');
    expect(body).toContain("12 similar requests about towing contracts");
    expect(body).toContain("Public Works");
    expect(body).toContain("about 6 days");
    expect(body).toContain("Bank details (trade secrets)");
    expect(body.trim().endsWith("City of Riverton")).toBe(true);
  });

  it("states history as history, never as a commitment (owner rule)", () => {
    const { body } = composePlayScaffold(base);
    expect(body).toContain("that is our history, not a commitment");
    expect(body).toContain("statutory due date for your request is Mon Aug 24 2026");
    // No SLA-shaped phrasing sneaks in.
    expect(body.toLowerCase()).not.toContain("we will respond within");
    expect(body.toLowerCase()).not.toContain("you will receive");
  });

  it("degrades stat by stat — missing numbers simply don't appear", () => {
    const { body } = composePlayScaffold({
      ...base,
      requesterName: null,
      statutoryDueDate: null,
      play: {
        topic: "towing contracts",
        episodeCount: 2,
        stats: {
          routes: [],
          exemptions: [],
          outcomes: {},
          medianDaysToClose: null,
          extensionRate: 0,
          samplePublicIds: [],
        },
      },
    });
    expect(body).toContain("Hi there,");
    expect(body).toContain("2 similar requests");
    expect(body).not.toContain("typically closed");
    expect(body).not.toContain("statutory due date");
    expect(body).not.toContain("redactions under");
    expect(body).not.toContain("undefined");
  });

  it("singularizes a one-episode play", () => {
    const { body } = composePlayScaffold({
      ...base,
      play: { ...base.play, episodeCount: 1 },
    });
    expect(body).toContain("1 similar request about");
  });
});
