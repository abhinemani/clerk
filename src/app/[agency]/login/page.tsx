import Link from "next/link";
import { notFound } from "next/navigation";
import { getAgencyForSlug } from "@/lib/live";
import { AuthForm } from "../../_components/AuthForm";

export default async function ResidentLoginPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency) notFound();

  return (
    <div className="wrap" style={{ maxWidth: 480, paddingBlock: "var(--page-top) var(--page-bottom)" }}>
      <Link href={`/${agency.slug}`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Back to portal
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 14 }}>
        {agency.name} · Public Records
      </span>
      <h1 style={{ fontSize: "1.8rem", marginTop: 8, marginBottom: 8, fontWeight: 600 }}>Sign in</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        See all your requests in one place and get updates at each step. You can always request
        without an account.
      </p>
      <AuthForm agencySlug={agency.slug} mode="requester-signin" />
      <p className="muted" style={{ fontSize: "0.9rem", marginTop: 16 }}>
        New here? <Link href={`/${agency.slug}/register`}>Create an account</Link>.
        {" · "}
        <Link href={`/${agency.slug}/forgot`}>Forgot password?</Link>
        {" · "}
        Work for the {agency.name}? <Link href={`/${agency.slug}/app/login`}>Staff sign-in</Link>.
      </p>
    </div>
  );
}
