/**
 * Requester API — public archive search (docs/requester-api.md). A JSON
 * projection of exactly what the portal's archive search shows an anonymous
 * visitor: the public corpus only (invariant 3 is enforced in the query
 * layer, not here). Per-agency opt-in via settings.requesterApi; plays dead
 * (404) when off, same idiom as the status API.
 */
import { getRepository } from "@/db/createRepository";
import { searchArchiveDetailed } from "@/lib/archive";
import { requesterApiConfig } from "@/services/requesterApiService";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ agency: string }> },
) {
  const { agency: slug } = await params;

  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  if (!agency || !requesterApiConfig(agency).enabled) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 3) {
    return Response.json({ error: "query_too_short", minLength: 3 }, { status: 400 });
  }

  const result = await searchArchiveDetailed(slug, q);
  return Response.json(
    {
      subject: result.subject,
      timeWindow: result.range,
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
    },
    { headers: { "cache-control": "no-store" } },
  );
}
