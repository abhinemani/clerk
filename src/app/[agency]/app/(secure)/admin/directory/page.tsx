import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import { DirectoryManager, type DirectoryRow } from "../../../../../_components/DirectoryManager";

export const dynamic = "force-dynamic";

export default async function DirectoryPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) notFound();
  const staff = await requireStaff(slug, ["admin"]);

  const repo = await getRepository();
  const entries = await repo.listDirectory(staff.agencyId);
  const rows: DirectoryRow[] = entries.map((e) => ({
    id: e.id,
    name: e.name,
    jurisdictionType: e.jurisdictionType,
    contactEmail: e.contactEmail,
    contactPhone: e.contactPhone,
    portalUrl: e.portalUrl,
    recordTypes: e.recordTypes,
    notes: e.notes,
  }));

  return (
    <div className="wrap" style={{ maxWidth: 900, paddingBlock: "36px" }}>
      <Link href={`/${slug}/app/admin`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Staff accounts
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 12 }}>
        {agency.name} · Administration
      </span>
      <h1 style={{ fontSize: "1.7rem", marginTop: 6, marginBottom: 6 }}>Referral directory</h1>
      <p className="muted" style={{ marginBottom: 20, maxWidth: 620 }}>
        The agencies you send people to when the records aren&apos;t yours. Staff pick from this
        list to refer a request, and the requester gets the contact details plus their own request
        text back — so they don&apos;t have to start over. A referral is recorded as its own
        outcome, never as a denial.
      </p>
      <DirectoryManager agencySlug={slug} rows={rows} />
    </div>
  );
}
