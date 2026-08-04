import Link from "next/link";
import { notFound } from "next/navigation";
import { getAgencyForSlug } from "@/lib/live";
import { requireStaff } from "@/auth/guards";
import { LegacyImportPanel } from "../../../../../_components/LegacyImportPanel";

export const dynamic = "force-dynamic";

export default async function LegacyImportPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) notFound();
  await requireStaff(slug, ["admin"]);

  return (
    <div className="wrap" style={{ maxWidth: 820, paddingBlock: "36px" }}>
      <Link href={`/${slug}/app/admin`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Staff accounts
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 12 }}>
        {agency.name} · Administration
      </span>
      <h1 style={{ fontSize: "1.7rem", marginTop: 6, marginBottom: 6 }}>Import legacy requests</h1>
      <p className="muted" style={{ marginBottom: 20, maxWidth: 560 }}>
        Bulk-load request history from a spreadsheet or a prior system. Admin-only.
      </p>
      <LegacyImportPanel agencySlug={slug} />
    </div>
  );
}
