/**
 * Release verification service (docs/release-verification.md): the repo-fed
 * half of src/domain/releaseVerification.ts. Verify answers with exactly the
 * tracker's level of fact (request public id, release date, filename) — a
 * verifier holds the bytes, which is at least as strong a credential as
 * holding the tracking number. The register joins public releases to their
 * request public ids for citation.
 */
import {
  buildRegisterRows,
  findChecksumMatch,
  normalizeSha256,
  type RegisterRow,
} from "@/domain/releaseVerification";
import type { Repository } from "./repository";

export type VerifyResult =
  | {
      verified: true;
      filename: string;
      releasedAt: string;
      requestPublicId: string | null;
      visibility: "public" | "private";
    }
  | { verified: false; reason: "invalid_hash" | "no_match" };

export async function verifyReleaseChecksum(
  repo: Repository,
  input: { agencyId: string; hash: string },
): Promise<VerifyResult> {
  const sha256 = normalizeSha256(input.hash);
  if (!sha256) return { verified: false, reason: "invalid_hash" };

  const releases = await repo.listAllReleases(input.agencyId);
  const match = findChecksumMatch(releases, sha256);
  if (!match) return { verified: false, reason: "no_match" };

  const request = await repo.getRequest(input.agencyId, match.release.requestId);
  return {
    verified: true,
    filename: match.artifact.filename,
    releasedAt: match.release.releasedAt.toISOString(),
    requestPublicId: request?.publicId ?? null,
    visibility: match.release.visibility,
  };
}

export interface RegisterEntry extends Omit<RegisterRow, "requestId"> {
  requestPublicId: string | null;
}

/** Public register rows with request public ids resolved for citation. */
export async function releaseRegister(
  repo: Repository,
  agencyId: string,
): Promise<RegisterEntry[]> {
  const rows = buildRegisterRows(await repo.listAllReleases(agencyId));
  const publicIds = new Map<string, string | null>();
  for (const row of rows) {
    if (!publicIds.has(row.requestId)) {
      const request = await repo.getRequest(agencyId, row.requestId);
      publicIds.set(row.requestId, request?.publicId ?? null);
    }
  }
  return rows.map(({ requestId, ...row }) => ({
    ...row,
    requestPublicId: publicIds.get(requestId) ?? null,
  }));
}
