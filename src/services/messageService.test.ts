/**
 * Tests for the correspondence loop (spec §5 messages, §6.6, §10) — the
 * invariants: named human on every outbound, append-only message events,
 * outbox delivery, internal notes stay internal, clarification round-trip.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository, NotFoundError, type Agency } from "./repository";
import type { ServiceDeps } from "./deps";
import { CollectingNotifier } from "./notifications";
import { MessageError, postRequesterReply, sendStaffMessage } from "./messageService";
import { submitRequest, transitionRequest } from "./requestService";

const AGENCY: Agency = {
  id: "ag-1",
  slug: "riverton",
  name: "City of Riverton",
  stateCode: "CA",
  observedHolidays: [],
};

async function setup() {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  const notifier = new CollectingNotifier();
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-07-27T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
    notifier,
  };
  const request = await submitRequest(deps, {
    agencyId: "ag-1",
    rawText: "All inspection reports for 400 Main St.",
    requester: { email: "jordan@example.com", name: "Jordan Alvarez" },
  });
  return { repo, deps, notifier, request };
}

describe("sendStaffMessage", () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    s = await setup();
  });

  it("stores the outbound message, appends a message event, and delivers to the requester", async () => {
    const msg = await sendStaffMessage(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      actorUserId: "staff-1",
      subject: "A quick question",
      body: "Which kind of inspection reports do you mean?",
    });
    expect(msg.direction).toBe("outbound");
    expect(msg.sentByUserId).toBe("staff-1");

    const thread = await s.repo.listMessages("ag-1", s.request.id);
    expect(thread).toHaveLength(1);

    const events = await s.repo.listEvents("ag-1", s.request.id);
    const evt = events.find((e) => e.kind === "message");
    expect(evt?.actorUserId).toBe("staff-1");
    expect(evt?.payload?.messageId).toBe(msg.id);

    expect(s.notifier.sent).toHaveLength(1);
    const delivery = s.notifier.sent[0]!;
    expect(delivery.to).toBe("jordan@example.com");
    expect(delivery.kind).toBe("requester_update");
    expect(delivery.body).toContain("/riverton/track?id=");
  });

  it("refuses an outbound message without a named sender", async () => {
    await expect(
      sendStaffMessage(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        actorUserId: "",
        body: "hello",
      }),
    ).rejects.toThrow(MessageError);
  });

  it("refuses an empty body", async () => {
    await expect(
      sendStaffMessage(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        actorUserId: "staff-1",
        body: "   ",
      }),
    ).rejects.toThrow(MessageError);
  });

  it("records AI provenance when the body was drafted by the pipeline", async () => {
    const msg = await sendStaffMessage(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      actorUserId: "staff-1",
      body: "Drafted by AI, approved by me.",
      aiDrafted: true,
      aiMeta: { promptVersion: "2026-07-27.1", model: "claude-test" },
    });
    expect(msg.aiDrafted).toBe(true);
    const events = await s.repo.listEvents("ag-1", s.request.id);
    const evt = events.find((e) => e.kind === "message");
    expect(evt?.payload?.aiDrafted).toBe(true);
    expect(evt?.payload?.promptVersion).toBe("2026-07-27.1");
  });

  it("moves the request to clarification_needed when asked (and legal)", async () => {
    await transitionRequest(s.deps, { agencyId: "ag-1", requestId: s.request.id, to: "in_review" });
    await sendStaffMessage(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      actorUserId: "staff-1",
      body: "Please narrow the date range.",
      requestClarification: true,
    });
    const r = await s.repo.getRequest("ag-1", s.request.id);
    expect(r?.status).toBe("clarification_needed");
  });

  it("refuses the clarification flag when the transition is illegal, writing nothing", async () => {
    // `submitted` cannot jump straight to clarification_needed.
    await expect(
      sendStaffMessage(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        actorUserId: "staff-1",
        body: "Please clarify.",
        requestClarification: true,
      }),
    ).rejects.toThrow(MessageError);
    expect(await s.repo.listMessages("ag-1", s.request.id)).toHaveLength(0);
    expect(s.notifier.sent).toHaveLength(0);
  });

  it("keeps internal notes internal — stored, audited, never delivered", async () => {
    const note = await sendStaffMessage(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      actorUserId: "staff-1",
      body: "Requester is a reporter — check with the City Attorney first.",
      internal: true,
    });
    expect(note.direction).toBe("internal_note");
    expect(s.notifier.sent).toHaveLength(0);
    const events = await s.repo.listEvents("ag-1", s.request.id);
    expect(events.some((e) => e.summary === "Internal note added")).toBe(true);
  });

  it("is tenant-isolated — another agency's request is invisible", async () => {
    await expect(
      sendStaffMessage(s.deps, {
        agencyId: "ag-other",
        requestId: s.request.id,
        actorUserId: "staff-1",
        body: "hello",
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("postRequesterReply", () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    s = await setup();
  });

  it("stores the inbound reply and appends a message event", async () => {
    const msg = await postRequesterReply(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      requesterId: s.request.requesterId!,
      body: "I mean building inspections only.",
    });
    expect(msg.direction).toBe("inbound");
    expect(msg.sentByUserId).toBeNull();
    const events = await s.repo.listEvents("ag-1", s.request.id);
    expect(events.some((e) => e.summary === "Requester replied")).toBe(true);
  });

  it("rejects a reply from a requester who doesn't own the request", async () => {
    await expect(
      postRequesterReply(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        requesterId: "someone-else",
        body: "let me in",
      }),
    ).rejects.toThrow(MessageError);
    expect(await s.repo.listMessages("ag-1", s.request.id)).toHaveLength(0);
  });

  it("puts a clarification_needed request back in review on reply", async () => {
    await transitionRequest(s.deps, { agencyId: "ag-1", requestId: s.request.id, to: "in_review" });
    await sendStaffMessage(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      actorUserId: "staff-1",
      body: "Which inspections?",
      requestClarification: true,
    });
    await postRequesterReply(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      requesterId: s.request.requesterId!,
      body: "Building inspections, 2024 only.",
    });
    const r = await s.repo.getRequest("ag-1", s.request.id);
    expect(r?.status).toBe("in_review");
    // Round-trip is fully audited: outbound, status out, inbound, status back.
    const events = await s.repo.listEvents("ag-1", s.request.id);
    const kinds = events.map((e) => e.summary);
    expect(kinds).toContain("Message sent to requester");
    expect(kinds).toContain("Requester replied");
  });

  it("leaves other statuses untouched on reply", async () => {
    await postRequesterReply(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      requesterId: s.request.requesterId!,
      body: "Just adding context.",
    });
    const r = await s.repo.getRequest("ag-1", s.request.id);
    expect(r?.status).toBe("submitted");
  });

  it("keeps the thread in chronological order", async () => {
    await transitionRequest(s.deps, { agencyId: "ag-1", requestId: s.request.id, to: "in_review" });
    await sendStaffMessage(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      actorUserId: "staff-1",
      body: "first",
    });
    await postRequesterReply(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      requesterId: s.request.requesterId!,
      body: "second",
    });
    const thread = await s.repo.listMessages("ag-1", s.request.id);
    expect(thread.map((m) => m.body)).toEqual(["first", "second"]);
  });
});
