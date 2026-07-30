import Link from "next/link";
import { notFound } from "next/navigation";
import { getAgencyForSlug } from "@/lib/live";
import { AuthForm } from "../../../_components/AuthForm";

export default async function StaffLoginPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency) notFound();

  return (
    <div className="wrap" style={{ maxWidth: 480, paddingBlock: "48px" }}>
      <Link href={`/${agency.slug}`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Back to portal
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 14 }}>
        {agency.name} · Staff workspace
      </span>
      <h1 style={{ fontSize: "1.8rem", marginTop: 8, marginBottom: 8, fontWeight: 600 }}>
        Staff sign-in
      </h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        For records staff of the {agency.name}. Accounts are created by your agency admin.
      </p>
      <AuthForm agencySlug={agency.slug} mode="staff-signin" />
      <p className="muted" style={{ fontSize: "0.9rem", marginTop: 16 }}>
        Resident? <Link href={`/${agency.slug}/login`}>Sign in here</Link>.
        {" · "}
        <Link href={`/${agency.slug}/forgot?staff=1`}>Forgot password?</Link>
      </p>
    </div>
  );
}
