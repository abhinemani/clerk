/**
 * Release verification (docs/release-verification.md) — invariant 8 cashed
 * in publicly: every release ships checksummed artifacts, so anyone HOLDING
 * a released file can prove it is byte-identical to what the agency shipped.
 *
 * Two distinct reads, deliberately different in scope:
 * - VERIFY searches every release (possession of the exact bytes is the
 *   credential) but answers only tracker-level facts.
 * - The REGISTER lists public releases only — the ones whose artifacts are
 *   already downloadable from the archive; it reveals nothing new.
 *
 * Placeholder checksums (metadata-only docs get a 16-char derived stamp at
 * release time) can never match: a verifiable input must be full sha-256.
 */
import type { ReleaseEntity } from "@/services/repository";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Normalize a user-supplied hash: trims, lowercases, strips an optional
 * "sha256:" prefix and internal whitespace. Null when it isn't a full
 * sha-256 — short placeholders and truncated pastes are unverifiable.
 */
export function normalizeSha256(raw: string): string | null {
  const cleaned = raw.trim().toLowerCase().replace(/^sha-?256:\s*/, "").replace(/\s+/g, "");
  return SHA256_HEX.test(cleaned) ? cleaned : null;
}

/** The checksum when it is a real, independently verifiable sha-256; else null. */
export function verifiableSha256(checksum: string | null | undefined): string | null {
  return checksum && SHA256_HEX.test(checksum) ? checksum : null;
}

export interface ChecksumMatch {
  release: ReleaseEntity;
  artifact: ReleaseEntity["artifacts"][number];
}

/** First artifact whose checksum equals the (normalized) hash. */
export function findChecksumMatch(releases: ReleaseEntity[], sha256: string): ChecksumMatch | null {
  for (const release of releases) {
    const artifact = release.artifacts.find((a) => a.checksum === sha256);
    if (artifact) return { release, artifact };
  }
  return null;
}

export interface RegisterRow {
  releaseId: string;
  releasedAt: Date;
  requestId: string;
  artifacts: { filename: string; sha256: string | null }[];
}

/**
 * The public register: PUBLIC releases only, newest first. Placeholder
 * checksums render as null — an honest "not independently verifiable"
 * beats printing a stamp that will never match anyone's file.
 */
export function buildRegisterRows(releases: ReleaseEntity[]): RegisterRow[] {
  return releases
    .filter((r) => r.visibility === "public")
    .sort((a, b) => b.releasedAt.getTime() - a.releasedAt.getTime())
    .map((r) => ({
      releaseId: r.id,
      releasedAt: r.releasedAt,
      requestId: r.requestId,
      artifacts: r.artifacts.map((a) => ({
        filename: a.filename,
        sha256: SHA256_HEX.test(a.checksum) ? a.checksum : null,
      })),
    }));
}
