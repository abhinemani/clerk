import Link from "next/link";
import { notFound } from "next/navigation";
import { getAgencyForSlug } from "@/lib/live";
import { ForgotPasswordForm } from "../../_components/PasswordForms";

export default async function ForgotPage({
  params,
  searchParams,
}: {
  params: Promise<{ agency: string }>;
  searchParams: Promise<{ staff?: string }>;
}) {
  const [{ agency: slug }, { staff }] = await Promise.all([params, searchParams]);
  const agency = await getAgencyForSlug(slug);
  if (!agency) notFound();
  const principal = staff ? "staff" : "requester";

  return (
    <div className="wrap" style={{ maxWidth: 480, paddingBlock: "var(--page-top) var(--page-bottom)" }}>
      <Link
        href={principal === "staff" ? `/${agency.slug}/app/login` : `/${agency.slug}/login`}
        className="muted"
        style={{ fontSize: "0.9rem" }}
      >
        ← Back to sign in
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 14 }}>
        {agency.name} · {principal === "staff" ? "Staff workspace" : "Public Records"}
      </span>
      <h1 style={{ fontSize: "1.8rem", marginTop: 8, marginBottom: 8, fontWeight: 600 }}>
        Reset your password
      </h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Enter your email and we&apos;ll send a one-time reset link.
      </p>
      <ForgotPasswordForm agencySlug={agency.slug} principal={principal} />
    </div>
  );
}
