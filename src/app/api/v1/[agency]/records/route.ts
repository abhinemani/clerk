/**
 * Ingestion REST API (spec §9.1): `POST /api/v1/{agency}/records`.
 *
 * "This alone makes the platform integrable by any IT shop or SI with a cron
 *  job." API-key auth per Source; idempotent on external ID. Backed by the dev
 *  in-memory store for now; the same handler will front the Postgres repo later.
 */
import { ingestRecord } from "@/dataplane/ingest";
import { DEV_INGEST_KEY, DEV_SOURCE } from "@/dataplane/store";
import { getRepository } from "@/db/createRepository";

// PGlite/postgres-js need the Node runtime (not edge).
export const runtime = "nodejs";

function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export async function POST(req: Request, { params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;

  const key = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (key !== DEV_INGEST_KEY) return unauthorized();

  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  if (!agency) return Response.json({ error: "unknown_agency (run `npm run seed`)" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const outcome = await ingestRecord(
    { repo, agency, source: DEV_SOURCE, genId: () => crypto.randomUUID(), now: () => new Date() },
    body,
  );

  return Response.json(outcome.body, { status: outcome.status });
}
