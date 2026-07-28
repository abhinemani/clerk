/**
 * Ingestion core (spec §9.1) — the logic behind `POST /api/v1/{agency}/records`,
 * factored out of the HTTP handler so it's unit-testable. Idempotent on external
 * ID: re-pushing the same record updates it in place rather than duplicating.
 */
import { z } from "zod";
import type { Agency, Repository } from "@/services/repository";
import { normalizeIngest, type SourceConfig } from "./normalize";

export const ingestPayloadSchema = z
  .object({
    externalId: z.string().min(1).optional(),
    filename: z.string().optional(),
    recordType: z.string().optional(),
    classification: z.enum(["public", "internal"]).optional(),
    text: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    deepLink: z.string().url().optional(),
  })
  .strict();

export interface IngestContext {
  repo: Repository;
  agency: Agency;
  source: SourceConfig;
  genId: () => string;
  now: () => Date;
}

export interface IngestOutcome {
  status: number;
  body: Record<string, unknown>;
}

export async function ingestRecord(ctx: IngestContext, rawPayload: unknown): Promise<IngestOutcome> {
  const parsed = ingestPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: "invalid_payload",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    };
  }

  const result = normalizeIngest(parsed.data, ctx.source, {
    genId: ctx.genId,
    now: ctx.now,
    agencyId: ctx.agency.id,
  });

  const { document, created } = await ctx.repo.upsertDocumentByExternalId(result.document);

  return {
    status: created ? 201 : 200,
    body: {
      id: document.id,
      created,
      status: document.processingStatus,
      classification: document.classification,
      held: result.held,
      publicVisible: result.publicVisible,
      ...(result.holdReason ? { holdReason: result.holdReason } : {}),
    },
  };
}
