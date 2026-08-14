import Link from "next/link";
import { notFound } from "next/navigation";
import { getAgencyForSlug } from "@/lib/live";
import { AuthForm } from "../../_components/AuthForm";

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ agency: string }>;
  searchParams: Promise<{ email?: string }>;
}) {
  const [{ agency: slug }, { email }] = await Promise.all([params, searchParams]);
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
      <h1 style={{ fontSize: "1.8rem", marginTop: 8, marginBottom: 8, fontWeight: 600 }}>
        Create an account
      </h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        If you&apos;ve filed requests with this email before, they&apos;ll appear in your account
        automatically.
      </p>
      <AuthForm agencySlug={agency.slug} mode="requester-register" initialEmail={email ?? ""} />
      <p className="muted" style={{ fontSize: "0.9rem", marginTop: 16 }}>
        Already have an account? <Link href={`/${agency.slug}/login`}>Sign in</Link>.
      </p>
    </div>
  );
}
