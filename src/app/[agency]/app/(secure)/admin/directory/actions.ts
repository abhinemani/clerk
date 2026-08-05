"use server";

/**
 * Agency-directory actions — the neighboring agencies this tenant refers
 * requests to. Admin-only; every change lands in the append-only admin audit.
 */
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import type { DirectoryEntry } from "@/services/repository";

export type DirectoryResult = { ok: true } | { ok: false; error: string };

export type JurisdictionType = DirectoryEntry["jurisdictionType"];

const JURISDICTIONS: JurisdictionType[] = [
  "city",
  "county",
  "state",
  "federal",
  "school_district",
  "special_district",
  "court",
  "other",
];

async function adminCtx(agencySlug: string) {
  const staff = await requireStaff(agencySlug, ["admin"]);
  const repo = await getRepository();
  const actor = await repo.getUser(staff.agencyId, staff.userId);
  return { staff, repo, actor };
}

export async function saveDirectoryEntryAction(input: {
  agencySlug: string;
  id?: string;
  name: string;
  jurisdictionType: string;
  contactEmail?: string;
  contactPhone?: string;
  portalUrl?: string;
  recordTypes?: string;
  notes?: string;
}): Promise<DirectoryResult> {
  try {
    const { staff, repo, actor } = await adminCtx(input.agencySlug);
    const name = input.name.trim();
    if (!name) return { ok: false, error: "Give the agency a name." };

    const jurisdictionType = (JURISDICTIONS as string[]).includes(input.jurisdictionType)
      ? (input.jurisdictionType as JurisdictionType)
      : "other";
    const fields = {
      name,
      jurisdictionType,
      contactEmail: input.contactEmail?.trim() || null,
      contactPhone: input.contactPhone?.trim() || null,
      portalUrl: input.portalUrl?.trim() || null,
      recordTypes: (input.recordTypes ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20),
      notes: input.notes?.trim() || null,
    };

    if (input.id) {
      await repo.updateDirectoryEntry(staff.agencyId, input.id, fields);
    } else {
      await repo.createDirectoryEntry({
        id: crypto.randomUUID(),
        agencyId: staff.agencyId,
        peerAgencyId: null,
        ...fields,
      });
    }

    await repo.appendAdminEvent({
      id: crypto.randomUUID(),
      agencyId: staff.agencyId,
      kind: "directory_changed",
      actorLabel: actor?.name ?? actor?.email ?? "admin",
      summary: `${input.id ? "Updated" : "Added"} referral directory entry: ${name}`,
      payload: { name, jurisdictionType },
      createdAt: new Date(),
    });
    revalidatePath(`/${input.agencySlug}/app/admin/directory`);
    return { ok: true };
  } catch (e) {
    console.error("saveDirectoryEntry failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the entry." };
  }
}

export async function deleteDirectoryEntryAction(input: {
  agencySlug: string;
  id: string;
}): Promise<DirectoryResult> {
  try {
    const { staff, repo, actor } = await adminCtx(input.agencySlug);
    const entry = await repo.getDirectoryEntry(staff.agencyId, input.id);
    await repo.deleteDirectoryEntry(staff.agencyId, input.id);
    await repo.appendAdminEvent({
      id: crypto.randomUUID(),
      agencyId: staff.agencyId,
      kind: "directory_changed",
      actorLabel: actor?.name ?? actor?.email ?? "admin",
      summary: `Removed referral directory entry: ${entry?.name ?? input.id}`,
      createdAt: new Date(),
    });
    revalidatePath(`/${input.agencySlug}/app/admin/directory`);
    return { ok: true };
  } catch (e) {
    console.error("deleteDirectoryEntry failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Could not remove the entry." };
  }
}
