/** Tests for request use cases (spec §5, §7, §10). */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository, NotFoundError, type Agency } from "./repository";
import type { ServiceDeps } from "./deps";
import { applyTriageDraft, submitRequest, transitionRequest } from "./requestService";
import { InvalidTransitionError } from "@/domain/requestLifecycle";

const AGENCY: Agency = {
  id: "ag-1",
  slug: "riverton",
  name: "City of Riverton",
  stateCode: "CA",
  observedHolidays: [],
};

function ctx() {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-07-27T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
  };
  return { repo, deps };
}

describe("submitRequest", () => {
  let repo: InMemoryRepository;
  let deps: ServiceDeps;
  beforeEach(() => ({ repo, deps } = ctx()));

  it("creates a submitted request with a public id and computed statutory deadline", async () => {
    const r = await submitRequest(deps, {
      agencyId: "ag-1",
      rawText: "All emails about zoning.",
      requester: { email: "j@news.com", name: "J", type: "media" },
    });
    expect(r.status).toBe("submitted");
    expect(r.publicId).toBe("PR-2026-00001");
    // CA = 10 calendar days from Jul 27 → Aug 6.
    expect(r.statutoryDueAt?.toISOString().slice(0, 10)).toBe("2026-08-06");

    const events = await repo.listEvents("ag-1", r.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("status_change");
    expect(events[0]!.payload?.to).toBe("submitted");
  });

  it("increments the per-agency/year sequence", async () => {
    const a = await submitRequest(deps, { agencyId: "ag-1", rawText: "one" });
    const b = await submitRequest(deps, { agencyId: "ag-1", rawText: "two" });
    expect(a.publicId).toBe("PR-2026-00001");
    expect(b.publicId).toBe("PR-2026-00002");
  });

  it("dedupes the requester by email within the agency", async () => {
    const a = await submitRequest(deps, { agencyId: "ag-1", rawText: "one", requester: { email: "x@y.com" } });
    const b = await submitRequest(deps, { agencyId: "ag-1", rawText: "two", requester: { email: "x@y.com" } });
    expect(a.requesterId).toBe(b.requesterId);
    expect(a.requesterId).not.toBeNull();
  });

  it("throws for an unknown agency", async () => {
    await expect(submitRequest(deps, { agencyId: "nope", rawText: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("transitionRequest", () => {
  let repo: InMemoryRepository;
  let deps: ServiceDeps;
  beforeEach(() => ({ repo, deps } = ctx()));

  it("advances through the lifecycle and logs each change", async () => {
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "x" });
    await transitionRequest(deps, { agencyId: "ag-1", requestId: r.id, to: "in_review" });
    const updated = await transitionRequest(deps, { agencyId: "ag-1", requestId: r.id, to: "in_progress" });
    expect(updated.status).toBe("in_progress");
    const events = await repo.listEvents("ag-1", r.id);
    expect(events.filter((e) => e.kind === "status_change")).toHaveLength(3); // submit + 2
  });

  it("rejects an illegal transition", async () => {
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "x" });
    await expect(
      transitionRequest(deps, { agencyId: "ag-1", requestId: r.id, to: "closed" }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});

describe("tenant isolation (§10)", () => {
  it("a request is invisible to another agency", async () => {
    const { repo, deps } = ctx();
    repo.seedAgency({ ...AGENCY, id: "ag-2", slug: "other" });
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "secret" });

    expect(await repo.getRequest("ag-2", r.id)).toBeNull();
    await expect(
      transitionRequest(deps, { agencyId: "ag-2", requestId: r.id, to: "in_review" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("applyTriageDraft", () => {
  it("stores the AI draft and logs an ai_action event", async () => {
    const { repo, deps } = ctx();
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "x" });
    const updated = await applyTriageDraft(deps, {
      agencyId: "ag-1",
      requestId: r.id,
      interpretedScope: "Zoning emails, 2025.",
      recordTypes: ["emails"],
      complexityScore: 0.7,
      promptVersion: "2026-07-27.1",
      model: "claude-sonnet-5",
    });
    expect(updated.interpretedScope).toBe("Zoning emails, 2025.");
    const ai = (await repo.listEvents("ag-1", r.id)).find((e) => e.kind === "ai_action");
    expect(ai?.payload?.promptVersion).toBe("2026-07-27.1");
  });
});
