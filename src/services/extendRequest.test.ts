/**
 * Extension-flow tests (§7; invariants 4 and 7): validated against the state
 * profile, deadline recomputed by the pure statute engine and logged with its
 * basis, statutory notice through the correspondence thread, one per request.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository, type Agency } from "./repository";
import type { ServiceDeps } from "./deps";
import { CollectingNotifier } from "./notifications";
import { ExtensionError, extendRequest, submitRequest } from "./requestService";

// CA profile: 10 calendar days, extension up to 14 calendar days, notice required.
const AGENCY: Agency = {
  id: "ag-1",
  slug: "riverton",
  name: "City of Riverton",
  stateCode: "CA",
  observedHolidays: [],
};

const REASON = "voluminous separate records";

async function setup() {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  const notifier = new CollectingNotifier();
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    // Wed 2026-07-29 → 10 calendar days = Sat 2026-08-08 → rolls to Mon 2026-08-10.
    now: () => new Date("2026-07-29T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
    notifier,
  };
  const request = await submitRequest(deps, {
    agencyId: "ag-1",
    rawText: "All 2024–2026 permit records.",
    requester: { email: "req@example.com", name: "Req Uester" },
  });
  return { repo, deps, notifier, request };
}

describe("extendRequest", () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    s = await setup();
  });

  it("extends the deadline, logs the basis, and notices the requester", async () => {
    expect(s.request.statutoryDueAt?.toISOString().slice(0, 10)).toBe("2026-08-10");

    const outcome = await extendRequest(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      actorUserId: "staff-1",
      days: 14,
      reason: REASON,
      note: "The permit archive spans three storage systems.",
    });

    // 14 calendar days from the (rolled) initial deadline of Mon 2026-08-10.
    expect(outcome.newDueAt.toISOString().slice(0, 10)).toBe("2026-08-24");
    expect(outcome.request.statutoryDueAt?.toISOString().slice(0, 10)).toBe("2026-08-24");
    expect(outcome.basis).toContain("Extended by 14 calendar day(s)");

    // Invariant 7: the extension event persists with its full basis.
    const events = await s.repo.listEvents("ag-1", s.request.id);
    const ext = events.find((e) => e.kind === "extension");
    expect(ext?.actorUserId).toBe("staff-1");
    expect(ext?.payload?.basis).toContain("Extended by 14 calendar day(s)");
    expect(ext?.payload?.from).toBe("2026-08-10");
    expect(ext?.payload?.to).toBe("2026-08-24");

    // History on the request itself.
    const r = await s.repo.getRequest("ag-1", s.request.id);
    expect(r?.extensionHistory).toHaveLength(1);
    expect(r?.extensionHistory?.[0]?.reason).toBe(REASON);

    // The §6.6 notice went out through the thread + outbox.
    expect(outcome.noticeSent).toBe(true);
    const thread = await s.repo.listMessages("ag-1", s.request.id);
    expect(thread).toHaveLength(1);
    expect(thread[0]!.body).toContain("The new response date is 2026-08-24");
    expect(thread[0]!.body).toContain(REASON);
    expect(thread[0]!.body).toContain("three storage systems");
    expect(s.notifier.sent.some((m) => m.kind === "requester_update")).toBe(true);
  });

  it("requires a named human (invariant 4)", async () => {
    await expect(
      extendRequest(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        actorUserId: "",
        days: 7,
        reason: REASON,
      }),
    ).rejects.toThrow(ExtensionError);
  });

  it("refuses a reason the statute does not permit", async () => {
    await expect(
      extendRequest(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        actorUserId: "staff-1",
        days: 7,
        reason: "we are busy",
      }),
    ).rejects.toThrow(/not a permitted extension reason/);
    // Nothing was written.
    expect((await s.repo.getRequest("ag-1", s.request.id))?.extensionHistory ?? []).toHaveLength(0);
  });

  it("refuses days beyond the statutory maximum", async () => {
    await expect(
      extendRequest(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        actorUserId: "staff-1",
        days: 15, // CA max is 14
        reason: REASON,
      }),
    ).rejects.toThrow(ExtensionError);
  });

  it("allows only one extension per request", async () => {
    await extendRequest(s.deps, {
      agencyId: "ag-1",
      requestId: s.request.id,
      actorUserId: "staff-1",
      days: 7,
      reason: REASON,
    });
    await expect(
      extendRequest(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        actorUserId: "staff-1",
        days: 7,
        reason: REASON,
      }),
    ).rejects.toThrow(/already been taken/);
  });

  it("refuses to extend a closed request", async () => {
    await s.repo.updateRequest("ag-1", s.request.id, { closedAt: new Date() });
    await expect(
      extendRequest(s.deps, {
        agencyId: "ag-1",
        requestId: s.request.id,
        actorUserId: "staff-1",
        days: 7,
        reason: REASON,
      }),
    ).rejects.toThrow(/closed/);
  });

  it("leaves a loud trace when notice is required but undeliverable", async () => {
    const anon = await submitRequest(s.deps, {
      agencyId: "ag-1",
      rawText: "Anonymous ask.",
      requester: { name: "Walk-in" }, // no email
    });
    const outcome = await extendRequest(s.deps, {
      agencyId: "ag-1",
      requestId: anon.id,
      actorUserId: "staff-1",
      days: 7,
      reason: REASON,
    });
    expect(outcome.noticeSent).toBe(false);
    const events = await s.repo.listEvents("ag-1", anon.id);
    expect(events.some((e) => e.summary.includes("notice required but"))).toBe(true);
  });
});
