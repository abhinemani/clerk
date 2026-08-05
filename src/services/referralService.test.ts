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
import { composeReferralLetter, referRequest, ReferralError } from "./referralService";
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
