/**
 * Requester API service: the opt-in reading (absent ⇒ dead, filing defaults
 * on only when the API is on), client keying, and fileViaApi riding the real
 * intake chain — real public id, statutory deadline, audit events — with the
 * filing itself surviving advisory-chain noise.
 */
import { describe, expect, it } from "vitest";
import type { ServiceDeps } from "./deps";
import { InMemoryRepository, type Agency } from "./repository";
import {
  apiClientKey,
  fileViaApi,
  requesterApiConfig,
} from "./requesterApiService";

const AGENCY: Agency = {
  id: "ag-1",
  slug: "riverton",
  name: "Riverton",
  stateCode: "CA",
  observedHolidays: [],
};

function ctx(agency: Agency = AGENCY) {
  const repo = new InMemoryRepository().seedAgency(agency);
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-08-14T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
  };
  return { repo, deps };
}

describe("requesterApiConfig", () => {
  it("absent settings mean everything off", () => {
    expect(requesterApiConfig(AGENCY)).toEqual({ enabled: false, filingEnabled: false });
    expect(requesterApiConfig(null)).toEqual({ enabled: false, filingEnabled: false });
  });

  it("enabled defaults filing ON; filing can be turned off separately; filing never leaks past a disabled API", () => {
    const withSettings = (requesterApi: { enabled: boolean; filingEnabled?: boolean }): Agency => ({
      ...AGENCY,
      settings: { requesterApi },
    });

    expect(requesterApiConfig(withSettings({ enabled: true }))).toEqual({
      enabled: true,
      filingEnabled: true,
    });
    expect(requesterApiConfig(withSettings({ enabled: true, filingEnabled: false }))).toEqual({
      enabled: true,
      filingEnabled: false,
    });
    expect(requesterApiConfig(withSettings({ enabled: false, filingEnabled: true }))).toEqual({
      enabled: false,
      filingEnabled: false,
    });
  });
});

describe("apiClientKey", () => {
  it("keys on agency + first forwarded hop, with a shared fallback bucket", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(apiClientKey(h, "riverton")).toBe("riverton:203.0.113.9");
    expect(apiClientKey(new Headers(), "riverton")).toBe("riverton:unknown");
  });
});

describe("fileViaApi", () => {
  it("files a real request: public id, CA statutory deadline, audit event", async () => {
    const { repo, deps } = ctx();
    const enqueued: string[] = [];
    const result = await fileViaApi(
      deps,
      {
        agencyId: "ag-1",
        text: "Building inspection reports for 212 Oak Avenue, 2024-2026",
        name: "Casey Reporter",
        email: "casey@example.com",
      },
      (kind) => enqueued.push(kind),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.publicId).toMatch(/^PR-2026-\d{5}$/);
    expect(result.dueAtISO).toBeTruthy(); // CA profile computes a real deadline
    expect(enqueued).toEqual(["intake_triage"]);

    const request = await repo.findRequestByPublicId("ag-1", result.publicId);
    expect(request?.status).toBe("submitted");
    expect(request?.rawText).toContain("212 Oak Avenue");

    const events = await repo.listEvents("ag-1", request!.id);
    expect(events.some((e) => e.kind === "status_change")).toBe(true);

    const requester = await repo.findRequesterByEmail("ag-1", "casey@example.com");
    expect(requester?.name).toBe("Casey Reporter");
  });

  it("refuses empty descriptions without touching the repo", async () => {
    const { repo, deps } = ctx();
    const result = await fileViaApi(deps, { agencyId: "ag-1", text: "  " });
    expect(result.ok).toBe(false);
    expect(await repo.listRequests("ag-1")).toHaveLength(0);
  });
});
