# Release verification — invariant 8, made public

Shipped 2026-08-14 (big-ticket board §5, "Trust you can verify"). Every
release has carried checksummed artifacts and a named approver since day
one; this surface lets the public USE those checksums: anyone holding a
file the agency released — a court, a newsroom, a skeptic — can confirm it
is byte-identical to what was shipped.

## The design line

Two reads with deliberately different scope (src/domain/releaseVerification.ts):

- **Verify** searches EVERY release (public and private): possession of the
  exact bytes is the credential — you cannot produce the sha-256 without
  the file, and the agency delivered that file. The answer is tracker-level
  only: filename, release date, request public id. Nothing about the
  requester, nothing about content.
- **The register** lists PUBLIC releases only — the ones whose artifacts
  already download from the archive. It reveals nothing new; it makes the
  existing record checkable.

**Placeholder checksums never verify.** Metadata-only documents get a
16-char derived stamp at release time (releaseService), not a content
hash; `normalizeSha256` requires the full 64-hex digest, so placeholders
can neither be verified nor spoofed, and the register renders them as
"not independently verifiable" rather than printing a dead stamp.

## Surface

- **`/{slug}/authenticity`** (opt-in via `settings.releaseVerification`,
  admin card "Release verification"; plays dead when off — the /log idiom;
  footer link appears when on). The verify form hashes the file **in the
  visitor's browser** with WebCrypto — bytes never travel; only the digest
  does. Paste-a-hash covers scripts. The no-match copy says out loud that
  a miss is not proof of tampering (re-saves, print-to-PDF, and gateway
  re-encoding all change bytes).
- **Status API artifacts now carry `sha256`** (verifiable digests only) —
  a machine client can download a released file and verify it end-to-end
  through the same projection; flows through the MCP get_request_status
  tool unchanged.

## Mechanics

- New port method `listAllReleases(agencyId)` (newest first,
  conformance-tested) — the one new repo read; verification scans
  checksums in memory, which at municipal release volumes is the right
  amount of machinery (revisit with an index if a tenant ships tens of
  thousands of releases).
- `src/domain/releaseVerification.ts` (pure, tested): normalize / match /
  register rows. `src/services/releaseVerificationService.ts` (tested):
  repo-fed verify + register with request public ids.
- Seed: Riverton enables the page; the seeded release (Wei's request runs
  the full lifecycle) makes it verifiable out of the box.
- No migration (settings are jsonb), no env vars, no model calls.

## Not built, on purpose

- **No append-only external transparency log (CT-style).** The registry is
  a projection of the DB; the append-only guarantee is invariant 5's,
  inside the system. Publishing signed tree heads somewhere external is a
  real upgrade — worth doing when a deployment has an audience for it.
- **No cross-file "which request is this from" search UI** beyond the
  hash lookup — the hash IS the query.
