/**
 * Requester tool registry: filing is present ONLY when the agency allows it,
 * the rate-limit gate refuses without filing, record text truncates, and
 * status lookups validate/normalize the tracking number. All deps faked —
 * the registry itself owns no data access.
 */
import { describe, expect, it } from "vitest";
import {
  buildRequesterTools,
  type RequesterToolDeps,
  type ToolArchiveRecord,
} from "./requesterTools";

const ITEM = {
  id: "doc-1",
  title: "Elm St inspection report",
  summary: "Inspection of 12 Elm St",
  date: "2026-05-01",
  tags: ["inspection"],
  downloadUrl: "/riverton/files/doc-1",
  recordDate: "2026-04-20",
  askedAs: ["inspections on Elm Street"],
  connectedSource: null,
};

function makeDeps(overrides: Partial<RequesterToolDeps> = {}): RequesterToolDeps {
  return {
    slug: "riverton",
    agencyName: "City of Riverton",
    filingEnabled: true,
    search: async () => ({ items: [ITEM], subject: "inspection", range: null }),
    getRecord: async () => null,
    getStatus: async () => null,
    file: async () => ({ ok: true, publicId: "PR-2026-00099", dueAtISO: "2026-08-28T00:00:00.000Z" }),
    allowFiling: () => true,
    ...overrides,
  };
}

const call = async (deps: RequesterToolDeps, name: string, args: Record<string, unknown>) => {
  const tool = buildRequesterTools(deps).find((t) => t.name === name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  const result = await tool.handler(args);
  return { ...result, parsed: JSON.parse(result.text) };
};

describe("buildRequesterTools", () => {
  it("registers file_request only when the agency allows filing", () => {
    const withFiling = buildRequesterTools(makeDeps()).map((t) => t.name);
    expect(withFiling).toEqual(["search_records", "get_record", "get_request_status", "file_request"]);

    const withoutFiling = buildRequesterTools(makeDeps({ filingEnabled: false })).map((t) => t.name);
    expect(withoutFiling).toEqual(["search_records", "get_record", "get_request_status"]);
  });

  it("search_records projects results with portal paths", async () => {
    const r = await call(makeDeps(), "search_records", { query: "inspection reports" });
    expect(r.isError).toBeFalsy();
    expect(r.parsed.resultCount).toBe(1);
    expect(r.parsed.results[0]).toMatchObject({
      id: "doc-1",
      downloadPath: "/riverton/files/doc-1",
      recordPath: "/riverton/archive/doc-1",
      previouslyAskedAs: ["inspections on Elm Street"],
    });
  });

  it("search_records refuses too-short queries as a tool error", async () => {
    const r = await call(makeDeps(), "search_records", { query: "ab" });
    expect(r.isError).toBe(true);
  });

  it("get_record truncates long extracted text and says so", async () => {
    const record: ToolArchiveRecord = {
      ...ITEM,
      recordType: "inspection",
      extractedText: "x".repeat(10_000),
      pageCount: 40,
      sourceRequestPublicId: "PR-2026-00001",
    };
    const r = await call(makeDeps({ getRecord: async () => record }), "get_record", { id: "doc-1" });
    expect(r.parsed.extractedText.length).toBeLessThan(6100);
    expect(r.parsed.note).toContain("truncated");
    expect(r.parsed.sourceRequest).toBe("PR-2026-00001");
  });

  it("get_record treats unknown/non-public ids identically", async () => {
    const r = await call(makeDeps(), "get_record", { id: "doc-internal" });
    expect(r.isError).toBe(true);
  });

  it("get_request_status normalizes case and rejects malformed numbers", async () => {
    let asked: string | null = null;
    const deps = makeDeps({
      getStatus: async (id) => {
        asked = id;
        return {
          publicId: id,
          status: "in_progress",
          statusLabel: "In progress",
          receivedAt: "2026-08-01T00:00:00.000Z",
          dueAt: null,
          closedAt: null,
          extension: null,
          timeline: [],
          artifacts: [],
          forwardedTo: null,
        };
      },
    });
    const ok = await call(deps, "get_request_status", { trackingNumber: " pr-2026-00042 " });
    expect(asked).toBe("PR-2026-00042");
    expect(ok.parsed.status).toBe("in_progress");

    const bad = await call(deps, "get_request_status", { trackingNumber: "12345" });
    expect(bad.isError).toBe(true);
  });

  it("file_request files through the injected chain and hands back the tracking number", async () => {
    const r = await call(makeDeps(), "file_request", {
      description: "Building inspection reports for 212 Oak Avenue, 2024-2026",
      requesterEmail: "casey@example.com",
    });
    expect(r.isError).toBeFalsy();
    expect(r.parsed).toMatchObject({
      filed: true,
      trackingNumber: "PR-2026-00099",
      statusApiPath: "/api/v1/riverton/requests/PR-2026-00099",
    });
  });

  it("file_request refuses when the rate limiter says no — and never calls the chain", async () => {
    let filed = false;
    const deps = makeDeps({
      allowFiling: () => false,
      file: async () => {
        filed = true;
        return { ok: true, publicId: "PR-2026-00100", dueAtISO: null };
      },
    });
    const r = await call(deps, "file_request", { description: "anything at all" });
    expect(r.isError).toBe(true);
    expect(filed).toBe(false);
  });

  it("file_request surfaces service-level failures as tool errors", async () => {
    const deps = makeDeps({ file: async () => ({ ok: false, error: "Filing failed." }) });
    const r = await call(deps, "file_request", { description: "some records" });
    expect(r.isError).toBe(true);
    expect(r.parsed.error).toBe("Filing failed.");
  });
});
