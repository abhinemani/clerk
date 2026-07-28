import Link from "next/link";
import { notFound } from "next/navigation";
import { getAgencyForSlug } from "@/lib/live";
import { RequestTracker } from "../../_components/RequestTracker";

export default async function TrackPage({
  params,
  searchParams,
}: {
  params: Promise<{ agency: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const [{ agency: slug }, { id }] = await Promise.all([params, searchParams]);
  const agency = await getAgencyForSlug(slug);
  if (!agency) notFound();

  return (
    <div className="wrap" style={{ maxWidth: 680, paddingBlock: "40px" }}>
      <Link href={`/${agency.slug}`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Back to portal
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 14 }}>
        {agency.name} · Public Records
      </span>
      <h1 style={{ fontSize: "2rem", marginTop: 8, marginBottom: 20, fontWeight: 600 }}>
        Track your request
      </h1>
      <RequestTracker agencySlug={agency.slug} initialId={id ?? ""} />
    </div>
  );
}
