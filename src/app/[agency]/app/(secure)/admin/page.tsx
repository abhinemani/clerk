import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import { requireStaff } from "@/auth/guards";
import { StaffRoster, type RosterRow } from "../../../../_components/StaffRoster";

export const dynamic = "force-dynamic";

export default async function AdminPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) notFound(); // demo fixture has no accounts to manage
  const staff = await requireStaff(slug, ["admin"]);

  const repo = await getRepository();
  const users = await repo.listUsers(agency.id);
  const rows: RosterRow[] = users
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email))
    .map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      isSelf: u.id === staff.userId,
      hasPassword: u.passwordHash != null,
    }));

  return (
    <div className="wrap" style={{ maxWidth: 820, paddingBlock: "36px" }}>
      <Link href={`/${slug}/app`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Command center
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 12 }}>
        {agency.name} · Administration
      </span>
      <h1 style={{ fontSize: "1.7rem", marginTop: 6, marginBottom: 6 }}>Staff accounts</h1>
      <p className="muted" style={{ marginBottom: 20, maxWidth: 560 }}>
        Who can work records for the {agency.name}, and what they can do. Admins manage this roster;
        coordinators run requests; responders only see tasks shared with them.
      </p>
      <StaffRoster agencySlug={slug} rows={rows} />
    </div>
  );
}
