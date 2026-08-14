import { notFound } from "next/navigation";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import { releaseRegister } from "@/services/releaseVerificationService";
import { VerifyReleaseForm } from "../../_components/VerifyReleaseForm";

export const dynamic = "force-dynamic";

/**
 * Release verification (docs/release-verification.md) — invariant 8 made
 * public: verify a released document against the office's own checksums,
 * plus the register of public releases. Opt-in per agency; plays dead when
 * off, the public-log idiom.
 */
export default async function AuthenticityPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) notFound();

  const repo = await getRepository();
  const agencyRow = await repo.getAgency(agency.id);
  if (agencyRow?.settings?.releaseVerification?.enabled !== true) notFound(); // opt-in

  const register = await releaseRegister(repo, agency.id);
  const verifiable = register.filter((r) => r.artifacts.some((a) => a.sha256));

  return (
    <div className="wrap" style={{ maxWidth: 860, paddingBlock: "36px 56px" }}>
      <span className="eyebrow">{agency.name} · Public Records</span>
      <h1 className="serif" style={{ fontSize: "1.9rem", marginTop: 8, fontWeight: 600 }}>
        Verify a released document
      </h1>
      <p className="muted" style={{ marginTop: 8, maxWidth: 620 }}>
        Every release from this office is fingerprinted (SHA-256) at the moment a named member of
        staff approves it. If you hold a released file — as a requester, a newsroom, or a court —
        you can confirm it is byte-identical to what the office shipped.
      </p>

      <div style={{ marginTop: 20 }}>
        <VerifyReleaseForm agencySlug={slug} />
      </div>

      <h2 style={{ fontSize: "1.1rem", marginTop: 34, marginBottom: 6 }}>
        Register of public releases
      </h2>
      <p className="muted" style={{ fontSize: "0.88rem", marginBottom: 12, maxWidth: 620 }}>
        Releases published to the archive, with each file&apos;s fingerprint. Records without a
        stored original are marked not independently verifiable.
      </p>

      {register.length === 0 ? (
        <div className="card card-pad">
          <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
            No public releases yet — fingerprints appear here the moment one ships.
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "10px 14px" }}>Released</th>
                <th style={{ padding: "10px 14px" }}>Request</th>
                <th style={{ padding: "10px 14px" }}>File</th>
                <th style={{ padding: "10px 14px" }}>SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {register.flatMap((row) =>
                row.artifacts.map((a, i) => (
                  <tr key={`${row.releaseId}-${i}`} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                      {row.releasedAt.toISOString().slice(0, 10)}
                    </td>
                    <td style={{ padding: "10px 14px" }} className="mono">
                      {row.requestPublicId ?? "—"}
                    </td>
                    <td style={{ padding: "10px 14px" }}>{a.filename}</td>
                    <td style={{ padding: "10px 14px" }} className="mono" title={a.sha256 ?? undefined}>
                      {a.sha256 ? `${a.sha256.slice(0, 16)}…` : <span className="muted">not independently verifiable</span>}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ fontSize: "0.8rem", marginTop: 16, maxWidth: 620 }}>
        {verifiable.length} of {register.length} public release{register.length === 1 ? "" : "s"}{" "}
        carry verifiable fingerprints. Files are fingerprinted in your browser and never uploaded.
      </p>
    </div>
  );
}
