/**
 * Requester status API (docs/agentic-horizon.md — the first brick of the
 * §16.4 agent-to-agent surface): the tracker's requester-safe projection as
 * versioned JSON. No auth: this serves exactly what /[slug]/track already
 * shows anyone holding the tracking number — nothing about the requester,
 * no raw filing text, no correspondence. Per-agency opt-in; plays dead
 * (404) when the agency hasn't enabled it, same idiom as the email-inbound
 * route's unconfigured state.
 */
import { getRepository } from "@/db/createRepository";
import { isPublicId } from "@/domain/publicId";
import { publicRequestStatus } from "@/services/statusApiService";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ agency: string; publicId: string }> },
) {
  const { agency: slug, publicId } = await params;

  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  if (!agency) return Response.json({ error: "unknown_agency" }, { status: 404 });
  if (agency.settings?.statusApi?.enabled !== true) {
    return Response.json({ error: "not_found" }, { status: 404 }); // opt-in: plays dead when off
  }

  const normalized = decodeURIComponent(publicId).trim().toUpperCase();
  if (!isPublicId(normalized)) {
    return Response.json({ error: "invalid_public_id" }, { status: 400 });
  }

  const status = await publicRequestStatus(repo, {
    agencyId: agency.id,
    agencySlug: slug,
    publicId: normalized,
  });
  if (!status) return Response.json({ error: "unknown_request" }, { status: 404 });

  return Response.json(status, {
    headers: { "cache-control": "no-store" }, // live state, never a stale CDN copy
  });
}
