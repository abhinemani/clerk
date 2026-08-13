/**
 * Inter-agency referral tests. The load-bearing distinction: a referral is
 * NOT a denial — it stops the clock, tells the requester exactly where to go,
 * and stays out of the agency's denial statistics.
 */
import { describe, expect, it } from "vitest";
import { InvalidTransitionError } from "@/domain/requestLifecycle";
import type { Notifier, OutboundMessage } from "./notifications";
import {
  InMemoryRepository,
  type Agency,
  type DirectoryEntry,
  type UserEntity,
} from "./repository";
import type { ServiceDeps } from "./deps";
import {
  composeForwardingLetter,
  composeReferralLetter,
  forwardRequest,
  referRequest,
  ReferralError,
} from "./referralService";
import { submitRequest, transitionRequest } from "./requestService";

const AGENCY: Agency = { id: "ag-1", slug: "riverton", name: "City of Riverton", stateCode: "CA", observedHolidays: [] };
const DANA: UserEntity = { id: "u-dana", agencyId: "ag-1", email: "dana@riverton.gov", name: "Dana", role: "admin", passwordHash: null };

const SCHOOL: DirectoryEntry = {
  id: "dir-school",
  agencyId: "ag-1",
  name: "Riverton Unified School District",
  jurisdictionType: "school_district",
  contactEmail: "records@rusd.example",
  contactPhone: "(555) 010-2000",
  portalUrl: "https://rusd.example/records",
  recordTypes: ["student records", "board minutes"],
  notes: null,
  peerAgencyId: null,
};

class CapturingNotifier implements Notifier {
  sent: OutboundMessage[] = [];
  async send(msg: OutboundMessage) {
    this.sent.push(msg);
    return { id: `n-${this.sent.length}`, channel: "outbox", to: msg.to, deliveredAt: new Date() };
  }
}

function ctx() {
  const repo = new InMemoryRepository().seedAgency(AGENCY).seedDirectoryEntry(SCHOOL);
  const notifier = new CapturingNotifier();
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-08-04T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
    notifier,
  };
  return { repo, deps, notifier };
}

async function openRequest(deps: ServiceDeps, email = "parent@example.com") {
  return submitRequest(deps, {
    agencyId: "ag-1",
    rawText: "My child's disciplinary file from Riverton High, spring 2026.",
    requester: { email, name: "Sam Ortiz" },
  });
}

describe("referRequest", () => {
  it("closes as referred (not denied), stops the clock, and records the target", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(DANA);
    const r = await openRequest(deps);

    const out = await referRequest(deps, {
      agencyId: "ag-1",
      requestId: r.id,
      directoryEntryId: "dir-school",
      actorUserId: "u-dana",
    });

    expect(out.request.status).toBe("referred");
    expect(out.request.status).not.toBe("denied");
    expect(out.request.closedAt).not.toBeNull(); // clock stopped
    expect(out.request.referredToDirectoryId).toBe("dir-school");
    expect(out.request.referredAt).toEqual(new Date("2026-08-04T12:00:00Z"));

    const events = await repo.listEvents("ag-1", r.id);
    const change = events.find((e) => e.kind === "status_change" && e.payload?.to === "referred");
    expect(change?.actorUserId).toBe("u-dana"); // named human
    expect(change?.summary).toContain("Riverton Unified School District");
  });

  it("emails the requester the target's contact details and their own text back", async () => {
    const { repo, deps, notifier } = ctx();
    await repo.createUser(DANA);
    const r = await openRequest(deps);
    notifier.sent = [];

    const out = await referRequest(deps, {
      agencyId: "ag-1",
      requestId: r.id,
      directoryEntryId: "dir-school",
      actorUserId: "u-dana",
      note: "Student discipline files are held by the district, not the city.",
    });

    expect(out.requesterNotified).toBe(true);
    const mail = notifier.sent.find((m) => m.to === "parent@example.com");
    expect(mail?.body).toContain("records@rusd.example");
    expect(mail?.body).toContain("https://rusd.example/records");
    expect(mail?.body).toContain("disciplinary file from Riverton High"); // their words, reusable
    expect(mail?.body).toContain("Student discipline files are held by the district");
    expect(mail?.body).toContain("referred — not denied");

    // Lives in the correspondence thread under the staff member's name.
    const thread = await repo.listMessages("ag-1", r.id);
    const sent = thread.find((m) => m.direction === "outbound" && m.subject?.includes("records held by"));
    expect(sent?.sentByUserId).toBe("u-dana");
    expect(sent?.aiDrafted).toBe(false);
  });

  it("optionally notifies the receiving agency, carrying only what the requester wrote", async () => {
    const { repo, deps, notifier } = ctx();
    await repo.createUser(DANA);
    const r = await openRequest(deps);
    notifier.sent = [];

    const out = await referRequest(deps, {
      agencyId: "ag-1",
      requestId: r.id,
      directoryEntryId: "dir-school",
      actorUserId: "u-dana",
      notifyTargetAgency: true,
    });

    expect(out.targetNotified).toBe(true);
    const toAgency = notifier.sent.find((m) => m.to === "records@rusd.example");
    expect(toAgency?.body).toContain("disciplinary file from Riverton High");
    expect(toAgency?.body).toContain("parent@example.com");
  });

  it("says the requester filed anonymously rather than inventing contact details", async () => {
    const { repo, deps, notifier } = ctx();
    await repo.createUser(DANA);
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "Board minutes." });
    notifier.sent = [];

    const out = await referRequest(deps, {
      agencyId: "ag-1",
      requestId: r.id,
      directoryEntryId: "dir-school",
      actorUserId: "u-dana",
      notifyTargetAgency: true,
    });

    expect(out.requesterNotified).toBe(false); // nobody to write to
    const toAgency = notifier.sent.find((m) => m.to === "records@rusd.example");
    expect(toAgency?.body).toContain("filed anonymously");
  });

  it("refuses to refer a request that is already closed", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(DANA);
    const r = await openRequest(deps);
    await referRequest(deps, { agencyId: "ag-1", requestId: r.id, directoryEntryId: "dir-school", actorUserId: "u-dana" });

    await expect(
      referRequest(deps, { agencyId: "ag-1", requestId: r.id, directoryEntryId: "dir-school", actorUserId: "u-dana" }),
    ).rejects.toThrow(ReferralError);
  });

  it("respects the lifecycle — a fulfilled request cannot be referred", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(DANA);
    const r = await openRequest(deps);
    await transitionRequest(deps, { agencyId: "ag-1", requestId: r.id, to: "in_review" });
    await transitionRequest(deps, { agencyId: "ag-1", requestId: r.id, to: "in_progress" });
    await transitionRequest(deps, { agencyId: "ag-1", requestId: r.id, to: "records_review" });
    await transitionRequest(deps, { agencyId: "ag-1", requestId: r.id, to: "fulfilled" });

    await expect(
      referRequest(deps, { agencyId: "ag-1", requestId: r.id, directoryEntryId: "dir-school", actorUserId: "u-dana" }),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("rejects unknown directory entries and users", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(DANA);
    const r = await openRequest(deps);
    await expect(
      referRequest(deps, { agencyId: "ag-1", requestId: r.id, directoryEntryId: "nope", actorUserId: "u-dana" }),
    ).rejects.toThrow(/DirectoryEntry/);
    await expect(
      referRequest(deps, { agencyId: "ag-1", requestId: r.id, directoryEntryId: "dir-school", actorUserId: "ghost" }),
    ).rejects.toThrow(/User/);
  });
});

describe("composeReferralLetter", () => {
  it("degrades honestly when we have no contact details on file", () => {
    const letter = composeReferralLetter({
      agencyName: "City of Riverton",
      publicId: "PR-2026-00007",
      target: { ...SCHOOL, contactEmail: null, contactPhone: null, portalUrl: null },
      rawText: "Some records.",
    });
    expect(letter.body).toContain("don't have contact details on file");
    expect(letter.body).not.toContain("Email:");
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — cross-tenant forwarding. Same Brandeis deployment, two tenants; the
// forward is the ONLY sanctioned crossing, and these tests pin its allow-list.
// ---------------------------------------------------------------------------

const BELLMAR: Agency = { id: "ag-2", slug: "bellmar", name: "City of Bellmar", stateCode: "CA", observedHolidays: [] };

const CITY_B: DirectoryEntry = {
  id: "dir-bellmar",
  agencyId: "ag-1",
  name: "City of Bellmar",
  jurisdictionType: "city",
  contactEmail: "records@bellmar.gov",
  contactPhone: null,
  portalUrl: null,
  recordTypes: ["bellmar city records"],
  notes: null,
  peerAgencyId: "ag-2", // ← the phase-3 link
};

function forwardCtx() {
  const base = ctx();
  base.repo.seedAgency(BELLMAR).seedDirectoryEntry(CITY_B);
  return base;
}

describe("forwardRequest — one deployment, two tenants", () => {
  it("creates a linked request in the target tenant and closes the source as referred", async () => {
    const { repo, deps } = forwardCtx();
    await repo.createUser(DANA);
    const r = await openRequest(deps);

    const out = await forwardRequest(deps, {
      agencyId: "ag-1",
      requestId: r.id,
      directoryEntryId: "dir-bellmar",
      actorUserId: "u-dana",
    });

    // Source: exactly the phase-1 outcome, plus the link.
    expect(out.request.status).toBe("referred");
    expect(out.request.closedAt).not.toBeNull();
    expect(out.request.forwardedTo).toMatchObject({
      agencyId: "ag-2",
      agencySlug: "bellmar",
      agencyName: "City of Bellmar",
      requestId: out.forwarded.id,
      publicId: out.forwarded.publicId,
    });

    // Target: a real request in Bellmar, text verbatim, provenance recorded.
    expect(out.forwarded.agencyId).toBe("ag-2");
    expect(out.forwarded.rawText).toBe(r.rawText);
    expect(out.forwarded.status).toBe("submitted");
    expect(out.forwarded.forwardedFrom).toMatchObject({
      agencyId: "ag-1",
      agencyName: "City of Riverton",
      publicId: r.publicId,
    });

    // Both trails tell the story.
    const sourceEvents = await repo.listEvents("ag-1", r.id);
    const sent = sourceEvents.find((e) => e.kind === "status_change" && e.payload?.to === "referred");
    expect(sent?.actorUserId).toBe("u-dana"); // named human
    expect(sent?.summary).toContain(`as ${out.forwarded.publicId}`);
    const targetEvents = await repo.listEvents("ag-2", out.forwarded.id);
    const received = targetEvents.find((e) => e.kind === "note");
    expect(received?.summary).toContain("City of Riverton");
    expect(received?.summary).toContain(r.publicId);
  });

  it("does NOT copy the requester without consent — the default", async () => {
    const { repo, deps } = forwardCtx();
    await repo.createUser(DANA);
    const r = await openRequest(deps, "sam@example.com");

    const out = await forwardRequest(deps, {
      agencyId: "ag-1",
      requestId: r.id,
      directoryEntryId: "dir-bellmar",
      actorUserId: "u-dana",
    });

    expect(out.forwarded.requesterId).toBeNull(); // anonymous at the target
    expect(await repo.findRequesterByEmail("ag-2", "sam@example.com")).toBeNull();
  });

  it("copies name+email with consent, deduping against an existing target-side requester", async () => {
    const { repo, deps } = forwardCtx();
    await repo.createUser(DANA);
    // Sam already has a Bellmar identity from an earlier direct request there.
    const existing = await repo.createRequester({
      id: "req-b-sam",
      agencyId: "ag-2",
      email: "sam@example.com",
      name: "Sam Ortiz",
      type: "individual",
    });
    const r = await openRequest(deps, "sam@example.com");

    const out = await forwardRequest(deps, {
      agencyId: "ag-1",
      requestId: r.id,
      directoryEntryId: "dir-bellmar",
      actorUserId: "u-dana",
      shareContact: true,
    });

    expect(out.forwarded.requesterId).toBe(existing.id); // deduped, not duplicated
  });

  it("tells the requester the new tracking number and whether contact was shared", async () => {
    const { repo, deps, notifier } = forwardCtx();
    await repo.createUser(DANA);
    const r = await openRequest(deps);
    notifier.sent = [];

    const out = await forwardRequest(deps, {
      agencyId: "ag-1",
      requestId: r.id,
      directoryEntryId: "dir-bellmar",
      actorUserId: "u-dana",
    });

    const mail = notifier.sent.find((m) => m.to === "parent@example.com");
    expect(mail?.body).toContain(out.forwarded.publicId);
    expect(mail?.body).toContain(`/bellmar/track?id=${encodeURIComponent(out.forwarded.publicId)}`);
    expect(mail?.body).toContain("did NOT share your contact details");
    expect(mail?.body).toContain("referred — not denied");
  });

  it("refuses to forward to an unlinked entry, itself, or from a closed request", async () => {
    const { repo, deps } = forwardCtx();
    await repo.createUser(DANA);
    repo.seedDirectoryEntry({ ...CITY_B, id: "dir-self", peerAgencyId: "ag-1" });
    const r = await openRequest(deps);

    await expect(
      forwardRequest(deps, { agencyId: "ag-1", requestId: r.id, directoryEntryId: "dir-school", actorUserId: "u-dana" }),
    ).rejects.toThrow(/not linked/);
    await expect(
      forwardRequest(deps, { agencyId: "ag-1", requestId: r.id, directoryEntryId: "dir-self", actorUserId: "u-dana" }),
    ).rejects.toThrow(/own agency/);

    await forwardRequest(deps, { agencyId: "ag-1", requestId: r.id, directoryEntryId: "dir-bellmar", actorUserId: "u-dana" });
    await expect(
      forwardRequest(deps, { agencyId: "ag-1", requestId: r.id, directoryEntryId: "dir-bellmar", actorUserId: "u-dana" }),
    ).rejects.toThrow(ReferralError);
  });

  it("INVARIANT: nothing beyond the allow-list crosses the tenant line", async () => {
    const { repo, deps } = forwardCtx();
    await repo.createUser(DANA);
    const r = await openRequest(deps);

    // Load the source request with everything that must NOT cross: an
    // interpreted scope, an internal note, a correspondence message, and a
    // document in the review set.
    await repo.updateRequest("ag-1", r.id, {
      interpretedScope: "Interpreted by Riverton staff — internal work product",
      recordTypes: ["disciplinary records"],
      assignedCoordinatorId: "u-dana",
    });
    await repo.appendEvent({
      id: "ev-note", agencyId: "ag-1", requestId: r.id, kind: "note", actorUserId: "u-dana",
      summary: "Internal: requester is a reporter, loop in counsel", payload: {}, createdAt: new Date(),
    });
    await repo.createMessage({
      id: "m-1", agencyId: "ag-1", requestId: r.id, direction: "outbound", channel: "email",
      subject: "internal thread", body: "sensitive correspondence", aiDrafted: false,
      sentByUserId: "u-dana", sentAt: new Date(), createdAt: new Date(),
    });
    await repo.createDocument({
      id: "doc-1", agencyId: "ag-1", sourceId: null, externalSystemId: null, filename: "sensitive.txt",
      classification: "internal", recordType: null, processingStatus: "ready", metadata: null,
      createdAt: new Date(),
    });
    await repo.linkRequestDocument("ag-1", r.id, "doc-1");

    const out = await forwardRequest(deps, {
      agencyId: "ag-1",
      requestId: r.id,
      directoryEntryId: "dir-bellmar",
      actorUserId: "u-dana",
    });
    const fwd = out.forwarded;

    // ALLOWED: the raw text, and the source's public identity for the trail.
    expect(fwd.rawText).toBe(r.rawText);
    expect(fwd.forwardedFrom?.publicId).toBe(r.publicId);

    // FORBIDDEN — staff work product starts fresh at the target:
    expect(fwd.interpretedScope).toBeNull();
    expect(fwd.recordTypes).toEqual([]);
    expect(fwd.assignedCoordinatorId ?? null).toBeNull();
    expect(fwd.requesterId).toBeNull(); // no consent given

    // FORBIDDEN — documents, messages, and events do not cross:
    expect(await repo.listRequestDocuments("ag-2", fwd.id)).toEqual([]);
    expect(await repo.listMessages("ag-2", fwd.id)).toEqual([]);
    const targetEvents = await repo.listEvents("ag-2", fwd.id);
    const targetTrail = JSON.stringify(targetEvents);
    expect(targetTrail).not.toContain("loop in counsel");
    expect(targetTrail).not.toContain("Interpreted by Riverton staff");
    expect(targetTrail).not.toContain("sensitive");
    // The source STAFF identity never appears in the target tenant — the
    // sender is an agency, not a person.
    expect(targetTrail).not.toContain("u-dana");
    expect(targetTrail).not.toContain("dana@riverton.gov");
    for (const e of targetEvents) expect(e.actorUserId).toBeNull();
  });
});

describe("composeForwardingLetter", () => {
  it("says contact WAS shared when consent was given", () => {
    const letter = composeForwardingLetter({
      agencyName: "City of Riverton",
      publicId: "PR-2026-00009",
      targetAgencyName: "City of Bellmar",
      targetPublicId: "PR-2026-00031",
      targetTrackLink: "http://localhost:3000/bellmar/track?id=PR-2026-00031",
      sharedContact: true,
    });
    expect(letter.body).toContain("shared your contact details");
    expect(letter.body).toContain("reply to you directly");
    expect(letter.body).not.toContain("did NOT share");
  });
});
