import Link from "next/link";
import { notFound } from "next/navigation";
import { getAgencyForSlug } from "@/lib/live";
import { sessionUser } from "@/auth/guards";
import { RequestForm } from "../../_components/RequestForm";

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ agency: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ agency: slug }, { q }] = await Promise.all([params, searchParams]);
  const agency = await getAgencyForSlug(slug);
  if (!agency) notFound();

  const user = await sessionUser();
  const signedInAs =
    user?.kind === "requester" && user.agencySlug === slug
      ? { name: user.name ?? "", email: user.email ?? "" }
      : null;

  return (
    <div className="wrap" style={{ maxWidth: 720, paddingBlock: "40px" }}>
      <Link href={`/${agency.slug}`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Back to portal
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 14 }}>
        {agency.name} · Public Records
      </span>
      <h1 style={{ fontSize: "2rem", marginTop: 8, marginBottom: 8, fontWeight: 600 }}>
        File a records request
      </h1>
      <p className="muted" style={{ fontSize: "1.02rem", marginBottom: 24 }}>
        Tell us what you&apos;re looking for in plain language. We&apos;ll route it to the right
        departments and keep you posted.
      </p>
      <RequestForm agencySlug={agency.slug} initialQuery={q ?? ""} signedInAs={signedInAs} />
    </div>
  );
}
