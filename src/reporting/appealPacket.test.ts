import { describe, expect, it } from "vitest";
import type {
  EventEntity,
  MessageEntity,
  ReleaseEntity,
  RequestEntity,
  ReviewEntity,
} from "@/services/repository";
import { buildAppealPacket, renderAppealPacketText } from "./appealPacket";

const NOW = new Date("2026-08-13T12:00:00Z");

function fixtureRequest(): RequestEntity {
  return {
    id: "req-1",
    agencyId: "ag-1",
    publicId: "PR-2026-00042",
    rawText: "All towing contracts with vendors since 2024",
    interpretedScope: "Towing contracts, 2024–present",
    status: "denied",
    receivedAt: new Date("2026-06-01T09:00:00Z"),
    statutoryDueAt: new Date("2026-06-15T00:00:00Z"),
    extensionHistory: [
      {
        at: "2026-06-10T10:00:00Z",
        byUserId: "u-dana",
        days: 14,
        reason: "Voluminous records require review",
        statutoryBasis: "Gov. Code § 6253(c)(2)",
      },
    ],
    closedAt: new Date("2026-07-01T16:00:00Z"),
    createdAt: new Date("2026-06-01T09:00:00Z"),
  } as RequestEntity;
}

function fixtures() {
  const events: EventEntity[] = [
    {
      id: "e1", agencyId: "ag-1", requestId: "req-1", kind: "status_change",
      actorUserId: "u-dana", summary: "Denied", payload: { from: "records_review", to: "denied" },
      createdAt: new Date("2026-07-01T16:00:00Z"),
    },
    {
      id: "e2", agencyId: "ag-1", requestId: "req-1", kind: "ai_action",
      actorUserId: null, summary: "Exemption pass",
      payload: { model: "claude-sonnet-5", promptVersion: "exemption-v3" },
      createdAt: new Date("2026-06-05T08:00:00Z"),
    },
  ];
  const reviews: ReviewEntity[] = [
    {
      id: "r1", agencyId: "ag-1", requestId: "req-1", documentId: "doc-1",
      decision: "withhold", exemptionLabel: "Trade secrets", decidedByUserId: "u-dana",
      createdAt: new Date("2026-06-20T10:00:00Z"),
    },
    {
      id: "r2", agencyId: "ag-1", requestId: "req-1", documentId: "doc-2",
      decision: "release_redacted", exemptionLabel: "Personal privacy", decidedByUserId: "u-dana",
      createdAt: new Date("2026-06-21T10:00:00Z"),
    },
  ];
  const messages: MessageEntity[] = [
    {
      id: "m1", agencyId: "ag-1", requestId: "req-1", direction: "outbound",
      channel: "email", subject: "Your request update", body: "…", aiDrafted: true,
      sentByUserId: "u-dana", sentAt: new Date("2026-06-11T09:00:00Z"), createdAt: new Date("2026-06-11T09:00:00Z"),
    },
    {
      id: "m2", agencyId: "ag-1", requestId: "req-1", direction: "internal_note" as MessageEntity["direction"],
      channel: "portal", subject: null, body: "internal only", aiDrafted: false,
      sentByUserId: "u-dana", sentAt: new Date("2026-06-12T09:00:00Z"), createdAt: new Date("2026-06-12T09:00:00Z"),
    },
  ];
  const releases: ReleaseEntity[] = [
    {
      id: "rel1", agencyId: "ag-1", requestId: "req-1",
      artifacts: [{ blobRef: "b1", filename: "contracts-redacted.pdf", checksum: "abc123" }],
      responseLetter: "Partial release", visibility: "private", approvedByUserId: "u-dana",
      releasedAt: new Date("2026-06-25T09:00:00Z"),
    },
  ];
  return { events, reviews, messages, releases };
}

describe("buildAppealPacket", () => {
  const packet = buildAppealPacket({
    agencyName: "City of Riverton",
    request: fixtureRequest(),
    ...fixtures(),
    actorNameById: new Map([["u-dana", "Dana Okafor"]]),
    documentNameById: new Map([["doc-1", "vendor-agreement.pdf"], ["doc-2", "tow-log.xlsx"]]),
    now: NOW,
  });

  it("tells the deadline story with bases and named humans (invariant 7)", () => {
    const basis = packet.deadlineBasis.join("\n");
    expect(basis).toContain("Received 2026-06-01");
    expect(basis).toContain("Statutory due date computed as 2026-06-15");
    expect(basis).toContain("Extended 14 day(s)");
    expect(basis).toContain("Dana Okafor");
    expect(basis).toContain("Gov. Code § 6253(c)(2)");
  });

  it("compiles the exemption log with deciders and resolves document names", () => {
    expect(packet.exemptions).toHaveLength(2);
    expect(packet.exemptions[0]).toMatchObject({
      document: "vendor-agreement.pdf",
      decision: "withhold",
      exemptionLabel: "Trade secrets",
      decidedBy: "Dana Okafor",
    });
  });

  it("excludes internal notes from correspondence", () => {
    expect(packet.correspondence).toHaveLength(1);
    expect(packet.correspondence[0]!.direction).toBe("outbound");
    expect(packet.correspondence[0]!.aiDrafted).toBe(true);
  });

  it("carries release checksums (invariant 8) and a clearly-marked draft memo", () => {
    expect(packet.releases[0]!.artifacts[0]!.checksum).toBe("abc123");
    expect(packet.coverMemo[0]).toContain("DRAFT");
    const memo = packet.coverMemo.join("\n");
    expect(memo).toContain("Trade secrets");
    expect(memo).toContain("0 released, 1 released with redactions, 1 withheld");
  });

  it("renders every section in the text export", () => {
    const text = renderAppealPacketText(packet);
    for (const heading of [
      "I. DEADLINE COMPUTATION BASES",
      "II. EXEMPTION LOG",
      "III. CORRESPONDENCE",
      "IV. RELEASES",
      "V. FULL AUDIT TRAIL",
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain("sha256:abc123");
    expect(text).toContain("PR-2026-00042");
  });
});
