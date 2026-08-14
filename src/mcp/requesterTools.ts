/**
 * The requester MCP tool set (docs/requester-api.md): what a resident's or
 * newsroom's agent can do against ONE agency's portal — search the public
 * archive, read a public record, check a tracking number, and (when the
 * agency allows it) file a real request. Deps are injected so the whole
 * registry is offline-testable; the route binds the real archive/status/
 * filing functions. Nothing here touches anything non-public: every dep is
 * itself a requester-facing projection (invariant 3 enforced below us).
 */
import { isPublicId } from "@/domain/publicId";
import type { McpTool, McpToolResult } from "./server";

// Structural copies of the projections we render — kept local so this module
// stays import-light and the tests can fake them without pulling the archive
// module's server-only dependency graph.
export interface ToolArchiveItem {
  id: string;
  title: string;
  summary: string;
  date: string;
  tags: string[];
  downloadUrl: string | null;
  recordDate: string;
  askedAs: string[];
  connectedSource: { sourceName: string; dataset: string; period: string; syncedAt: string } | null;
}

export interface ToolArchiveRecord extends ToolArchiveItem {
  recordType: string | null;
  extractedText: string | null;
  pageCount: number | null;
  sourceRequestPublicId: string | null;
}

export interface ToolRequestStatus {
  publicId: string;
  status: string;
  statusLabel: string;
  receivedAt: string;
  dueAt: string | null;
  closedAt: string | null;
  extension: { days: number; reason: string; at: string } | null;
  timeline: { label: string; at: string }[];
  artifacts: { filename: string; url: string; sha256: string | null }[];
  forwardedTo: { agencyName: string; publicId: string } | null;
}

export interface RequesterToolDeps {
  slug: string;
  agencyName: string;
  /** Filing tool registered only when true (per-agency admin gate). */
  filingEnabled: boolean;
  search: (query: string) => Promise<{
    items: ToolArchiveItem[];
    subject: string;
    range: { from: string; to: string } | null;
  }>;
  getRecord: (id: string) => Promise<ToolArchiveRecord | null>;
  getStatus: (publicId: string) => Promise<ToolRequestStatus | null>;
  file: (input: {
    text: string;
    name?: string;
    email?: string;
  }) => Promise<{ ok: true; publicId: string; dueAtISO: string | null } | { ok: false; error: string }>;
  /** Rate-limit gate for filing; route binds the shared limiter. */
  allowFiling: () => boolean;
}

/** extractedText can be a whole meeting packet; agents page via get_record. */
const MAX_RECORD_TEXT = 6000;

function json(value: unknown, isError = false): McpToolResult {
  return { text: JSON.stringify(value, null, 2), isError };
}

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export function buildRequesterTools(deps: RequesterToolDeps): McpTool[] {
  const { slug } = deps;

  const searchRecords: McpTool = {
    name: "search_records",
    description:
      `Search ${deps.agencyName}'s public records archive — records the agency has already ` +
      `published. Call this FIRST, before filing a request: if the records are here, no ` +
      `request is needed and the download links work immediately. Queries may include a ` +
      `time window in plain language ("inspection reports last 3 months"). Returns only ` +
      `public records; results are the same an anonymous visitor sees on the portal.`,
    inputSchema: obj(
      { query: { type: "string", description: "What records to look for, in plain language." } },
      ["query"],
    ),
    handler: async (args) => {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (query.length < 3) return json({ error: "query must be at least 3 characters" }, true);
      const result = await deps.search(query);
      return json({
        subject: result.subject,
        timeWindow: result.range,
        resultCount: result.items.length,
        results: result.items.map((it) => ({
          id: it.id,
          title: it.title,
          summary: it.summary,
          recordDate: it.recordDate,
          tags: it.tags,
          downloadPath: it.downloadUrl,
          recordPath: `/${slug}/archive/${it.id}`,
          previouslyAskedAs: it.askedAs,
          connectedSource: it.connectedSource,
        })),
        note:
          result.items.length === 0
            ? "No published records matched. Consider filing a request with file_request if available."
            : "Paths are relative to the portal origin. Use get_record for a record's full text.",
      });
    },
  };

  const getRecord: McpTool = {
    name: "get_record",
    description:
      `Fetch one public record from ${deps.agencyName}'s archive by id (from search_records), ` +
      `including its extracted full text when available. Public records only — a non-public ` +
      `id behaves as if it does not exist.`,
    inputSchema: obj(
      { id: { type: "string", description: "Record id from a search_records result." } },
      ["id"],
    ),
    handler: async (args) => {
      const id = typeof args.id === "string" ? args.id.trim() : "";
      if (!id) return json({ error: "id is required" }, true);
      const record = await deps.getRecord(id);
      if (!record) return json({ error: "No public record with that id." }, true);
      const text = record.extractedText ?? null;
      const truncated = text !== null && text.length > MAX_RECORD_TEXT;
      return json({
        id: record.id,
        title: record.title,
        summary: record.summary,
        recordType: record.recordType,
        recordDate: record.recordDate,
        tags: record.tags,
        pageCount: record.pageCount,
        downloadPath: record.downloadUrl,
        recordPath: `/${slug}/archive/${record.id}`,
        sourceRequest: record.sourceRequestPublicId,
        connectedSource: record.connectedSource,
        extractedText: truncated ? `${text!.slice(0, MAX_RECORD_TEXT)}…` : text,
        ...(truncated
          ? { note: `Text truncated at ${MAX_RECORD_TEXT} characters; download the record for the full document.` }
          : {}),
      });
    },
  };

  const getRequestStatus: McpTool = {
    name: "get_request_status",
    description:
      `Check the status of a public-records request at ${deps.agencyName} by tracking number ` +
      `(format PR-YYYY-NNNNN). Returns exactly what the public tracker shows anyone holding ` +
      `the number: status, statutory deadline, milestone timeline, and released files — ` +
      `never requester details or correspondence.`,
    inputSchema: obj(
      { trackingNumber: { type: "string", description: "The request's tracking number, e.g. PR-2026-00042." } },
      ["trackingNumber"],
    ),
    handler: async (args) => {
      const raw = typeof args.trackingNumber === "string" ? args.trackingNumber : "";
      const publicId = raw.trim().toUpperCase();
      if (!isPublicId(publicId)) {
        return json({ error: "trackingNumber must look like PR-YYYY-NNNNN" }, true);
      }
      const status = await deps.getStatus(publicId);
      if (!status) return json({ error: `No request found for ${publicId}.` }, true);
      return json(status);
    },
  };

  const fileRequest: McpTool = {
    name: "file_request",
    description:
      `File a REAL public-records request with ${deps.agencyName}. This is a legal act: it ` +
      `creates a tracked request with a statutory response deadline that agency staff must ` +
      `handle. ALWAYS call search_records first and only file when the records are not ` +
      `already published. Describe the records specifically (what, who, and a date range). ` +
      `Provide the requester's email so the agency can respond and the tracking number is ` +
      `recoverable; requests may also be filed anonymously.`,
    inputSchema: obj(
      {
        description: {
          type: "string",
          description: "What records are being requested, specifically (subject, parties, date range).",
        },
        requesterName: { type: "string", description: "Requester's name (optional)." },
        requesterEmail: { type: "string", description: "Requester's email for responses (optional but recommended)." },
      },
      ["description"],
    ),
    handler: async (args) => {
      if (!deps.allowFiling()) {
        return json(
          { error: "Filing rate limit reached for this client. Try again later." },
          true,
        );
      }
      const text = typeof args.description === "string" ? args.description : "";
      const name = typeof args.requesterName === "string" ? args.requesterName : undefined;
      const email = typeof args.requesterEmail === "string" ? args.requesterEmail : undefined;
      const result = await deps.file({ text, name, email });
      if (!result.ok) return json({ error: result.error }, true);
      return json({
        filed: true,
        trackingNumber: result.publicId,
        statutoryDueAt: result.dueAtISO,
        statusApiPath: `/api/v1/${slug}/requests/${result.publicId}`,
        trackPath: `/${slug}/track`,
        note: "Save the tracking number — it is how this request is checked from now on.",
      });
    },
  };

  return [searchRecords, getRecord, getRequestStatus, ...(deps.filingEnabled ? [fileRequest] : [])];
}
