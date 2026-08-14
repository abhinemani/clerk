/**
 * Requester API — machine filing (docs/requester-api.md). POST files a REAL
 * request through the shared intake chain (intakeService.submitAndDispatch):
 * real public id, statutory deadline, audit events, routing, triage — the
 * same path as the portal form. Separately gated (requesterApi.filingEnabled)
 * and rate-limited: a machine can file faster than a form.
 */
import { getRepository } from "@/db/createRepository";
import { defaultDeps } from "@/services/deps";
import {
  apiClientKey,
  fileViaApi,
  filingLimiter,
  requesterApiConfig,
} from "@/services/requesterApiService";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ agency: string }> },
) {
  const { agency: slug } = await params;

  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  const config = requesterApiConfig(agency);
  if (!agency || !config.enabled || !config.filingEnabled) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  if (!filingLimiter.allow(apiClientKey(req.headers, slug), Date.now())) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const text = typeof b.text === "string" ? b.text : "";
  const name = typeof b.name === "string" ? b.name : undefined;
  const email = typeof b.email === "string" ? b.email : undefined;

  const result = await fileViaApi(defaultDeps(repo), { agencyId: agency.id, text, name, email });
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

  return Response.json(
    {
      trackingNumber: result.publicId,
      statutoryDueAt: result.dueAtISO,
      statusApiPath: `/api/v1/${slug}/requests/${result.publicId}`,
      trackPath: `/${slug}/track`,
    },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}
