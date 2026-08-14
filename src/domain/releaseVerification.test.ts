/**
 * Release verification domain: hash normalization is forgiving on format and
 * strict on substance (full sha-256 only — 16-char placeholders can never
 * verify), matching is exact, and the register serves PUBLIC releases only
 * with placeholders honestly nulled.
 */
import { describe, expect, it } from "vitest";
import type { ReleaseEntity } from "@/services/repository";
import {
  buildRegisterRows,
  findChecksumMatch,
  normalizeSha256,
  verifiableSha256,
} from "./releaseVerification";

const SHA = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

const release = (over: Partial<ReleaseEntity>): ReleaseEntity => ({
  id: "rel-1",
  agencyId: "ag-1",
  requestId: "req-1",
  artifacts: [{ blobRef: "k", filename: "report.pdf", checksum: SHA }],
  responseLetter: null,
  visibility: "public",
  approvedByUserId: "u-1",
  releasedAt: new Date("2026-06-01T00:00:00Z"),
  ...over,
});

describe("normalizeSha256", () => {
  it("accepts case, whitespace, and a sha256: prefix", () => {
    expect(normalizeSha256(`  ${SHA.toUpperCase()}  `)).toBe(SHA);
    expect(normalizeSha256(`sha256: ${SHA}`)).toBe(SHA);
    expect(normalizeSha256(`SHA-256:${SHA.slice(0, 32)} ${SHA.slice(32)}`)).toBe(SHA);
  });

  it("rejects anything that is not a full sha-256", () => {
    expect(normalizeSha256(SHA.slice(0, 16))).toBeNull(); // placeholder length
    expect(normalizeSha256("")).toBeNull();
    expect(normalizeSha256("not-a-hash")).toBeNull();
    expect(normalizeSha256(`${SHA}00`)).toBeNull();
  });
});

describe("findChecksumMatch", () => {
  it("finds the artifact carrying the hash", () => {
    const rel = release({});
    const match = findChecksumMatch([release({ id: "other", artifacts: [] }), rel], SHA);
    expect(match?.release.id).toBe("rel-1");
    expect(match?.artifact.filename).toBe("report.pdf");
  });

  it("matches private releases too — possession of the bytes is the credential", () => {
    const match = findChecksumMatch([release({ visibility: "private" })], SHA);
    expect(match?.release.visibility).toBe("private");
  });

  it("returns null when nothing matches", () => {
    expect(findChecksumMatch([release({})], SHA.replace("9", "a"))).toBeNull();
  });
});

describe("buildRegisterRows", () => {
  it("lists public releases only, newest first, nulling placeholder checksums", () => {
    const rows = buildRegisterRows([
      release({ id: "old", releasedAt: new Date("2026-01-01T00:00:00Z") }),
      release({ id: "private", visibility: "private" }),
      release({
        id: "new",
        releasedAt: new Date("2026-07-01T00:00:00Z"),
        artifacts: [{ blobRef: "k2", filename: "minutes.pdf", checksum: "abc123def4567890" }],
      }),
    ]);
    expect(rows.map((r) => r.releaseId)).toEqual(["new", "old"]);
    expect(rows[0]!.artifacts[0]!.sha256).toBeNull(); // 16-char placeholder
    expect(rows[1]!.artifacts[0]!.sha256).toBe(SHA);
  });
});

describe("verifiableSha256", () => {
  it("passes real digests and nulls placeholders", () => {
    expect(verifiableSha256(SHA)).toBe(SHA);
    expect(verifiableSha256("abc123def4567890")).toBeNull();
    expect(verifiableSha256(null)).toBeNull();
  });
});
