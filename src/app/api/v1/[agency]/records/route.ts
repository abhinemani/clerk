/**
 * Ingestion REST API (spec §9.1): `POST /api/v1/{agency}/records`.
 *
 * "This alone makes the platform integrable by any IT shop or SI with a cron
 *  job." Auth is a per-source API key: the presented Bearer key is hashed and
 *  looked up against the agency's sources (nothing but the hash is stored, so
 *  comparison is inherently constant-time). One key writes to ONE agency.
 *  In non-production the legacy shared dev key still works for local scripts.
 */
import { createHash } from "node:crypto";
import { ingestRecord } from "@/dataplane/ingest";
import { DEV_INGEST_KEY, DEV_SOURCE } from "@/dataplane/store";
import { getRepository } from "@/db/createRepository";
import type { SourceConfig } from "@/dataplane/normalize";

// PGlite/postgres-js need the Node runtime (not edge).
export const runtime = "nodejs";

function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export async function POST(req: Request, { params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const key = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!key) return unauthorized();

  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  if (!agency) return Response.json({ error: "unknown_agency (run `npm run seed`)" }, { status: 404 });

  // Per-source key → per-agency scope. Hash lookup, no raw keys at rest.
  const keyHash = createHash("sha256").update(key).digest("hex");
  const source = await repo.findSourceByApiKeyHash(agency.id, keyHash);

  let sourceConfig: SourceConfig | null = null;
  if (source) {
    sourceConfig = {
      id: source.id,
      trust: source.trust,
      defaultClassification: source.defaultClassification,
    };
  } else if (process.env.NODE_ENV !== "production" && key === DEV_INGEST_KEY) {
    sourceConfig = DEV_SOURCE; // local scripts only; refused in production
  }
  if (!sourceConfig) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const outcome = await ingestRecord(
    { repo, agency, source: sourceConfig, genId: () => crypto.randomUUID(), now: () => new Date() },
    body,
  );

  if (outcome.status < 300) {
    // The corpus may have grown — keep the archive's search vectors current.
    const { getJobQueue } = await import("@/jobs/queue");
    getJobQueue().enqueue("embed_public_documents", { agencyId: agency.id });
  }

  return Response.json(outcome.body, { status: outcome.status });
}
