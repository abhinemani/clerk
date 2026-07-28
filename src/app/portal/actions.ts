"use server";

/**
 * Portal server actions — the requester-facing writes/reads.
 *
 * Filing goes through the real service layer (`submitRequest`), so a portal
 * submission mints a public id, computes the statutory deadline, persists, and
 * appends audit events — then shows up in the staff queue. If the operator
 * never ran `npm run seed`, the first filing bootstraps the demo agency.
 */
import { getRepository } from "@/db/createRepository";
import { ensureAgency } from "@/lib/bootstrap";
import { trackByPublicId } from "@/lib/live";
import { defaultDeps } from "@/services/deps";
import type { RequesterType } from "@/services/repository";
import { submitRequest } from "@/services/requestService";

export type FileRequestResult =
  | { ok: true; publicId: string; dueAtISO: string | null }
  | { ok: false; error: string };

export async function fileRequest(input: {
  text: string;
  name?: string;
  email?: string;
  type?: RequesterType;
}): Promise<FileRequestResult> {
  const rawText = input.text?.trim() ?? "";
  if (rawText.length < 3) return { ok: false, error: "Tell us what records you're looking for." };

  try {
    const { agencyId } = await ensureAgency();
    const deps = defaultDeps(await getRepository());
    const request = await submitRequest(deps, {
      agencyId,
      rawText,
      requester: {
        email: input.email?.trim() || undefined,
        name: input.name?.trim() || undefined,
        type: input.type,
      },
    });
    return { ok: true, publicId: request.publicId, dueAtISO: request.statutoryDueAt?.toISOString() ?? null };
  } catch (e) {
    console.error("fileRequest failed", e);
    return { ok: false, error: "Something went wrong filing your request. Please try again." };
  }
}

export type TrackResult =
  | { found: true; publicId: string; status: string; receivedAtISO: string; dueAtISO: string; daysLeft: number }
  | { found: false };

export async function trackRequest(publicId: string): Promise<TrackResult> {
  const hit = await trackByPublicId(publicId.trim());
  if (!hit) return { found: false };
  const daysLeft = Math.round((hit.dueAt.getTime() - hit.now.getTime()) / 86_400_000);
  return {
    found: true,
    publicId: hit.publicId,
    status: hit.status,
    receivedAtISO: hit.receivedAt.toISOString(),
    dueAtISO: hit.dueAt.toISOString(),
    daysLeft,
  };
}
