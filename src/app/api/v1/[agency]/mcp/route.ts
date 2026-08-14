/**
 * Requester MCP server (docs/requester-api.md) — streamable-HTTP transport,
 * stateless: every POST is one JSON-RPC message, answered with JSON (no
 * sessions, no SSE — GET is 405 as the spec allows). The tool set is bound
 * per-agency from the same requester-safe projections the REST routes serve;
 * per-agency opt-in via settings.requesterApi, plays dead (404) when off.
 */
import { getRepository } from "@/db/createRepository";
import { getArchiveRecord, searchArchiveDetailed } from "@/lib/archive";
import { buildRequesterTools } from "@/mcp/requesterTools";
import { handleMcpMessage, mcpParseError, type McpHttpResult } from "@/mcp/server";
import { defaultDeps } from "@/services/deps";
import {
  apiClientKey,
  fileViaApi,
  filingLimiter,
  requesterApiConfig,
} from "@/services/requesterApiService";
import { publicRequestStatus } from "@/services/statusApiService";

export const runtime = "nodejs";

function toResponse(result: McpHttpResult): Response {
  if (result.body === null) return new Response(null, { status: result.status });
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ agency: string }> },
) {
  const { agency: slug } = await params;

  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  const config = requesterApiConfig(agency);
  if (!agency || !config.enabled) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  let message: unknown;
  try {
    message = await req.json();
  } catch {
    return toResponse(mcpParseError());
  }

  const clientKey = apiClientKey(req.headers, slug);
  const tools = buildRequesterTools({
    slug,
    agencyName: agency.name,
    filingEnabled: config.filingEnabled,
    search: (query) => searchArchiveDetailed(slug, query),
    getRecord: (id) => getArchiveRecord(slug, id),
    getStatus: (publicId) =>
      publicRequestStatus(repo, { agencyId: agency.id, agencySlug: slug, publicId }),
    file: (input) =>
      fileViaApi(defaultDeps(repo), {
        agencyId: agency.id,
        text: input.text,
        name: input.name,
        email: input.email,
      }),
    allowFiling: () => filingLimiter.allow(clientKey, Date.now()),
  });

  const result = await handleMcpMessage(
    {
      name: "brandeis-requester",
      version: "1.0.0",
      instructions:
        `Public-records tools for ${agency.name}. Search the published archive first ` +
        `(search_records / get_record); check tracking numbers with get_request_status; ` +
        `file_request files a real request with a statutory deadline — use it only when ` +
        `the records are not already published.`,
    },
    tools,
    message,
  );
  return toResponse(result);
}

// No server-initiated stream: stateless by design. 405 per the MCP spec's
// allowance for servers that don't offer an SSE channel.
export function GET() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
