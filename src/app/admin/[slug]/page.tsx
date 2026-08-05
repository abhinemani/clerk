import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import {
  DirectoryPeerLinks,
  PlatformStaffTable,
  type DirectoryLinkRow,
  type PlatformStaffRow,
} from "../../_components/PlatformConsole";
import { Avatar } from "../../_components/ui";

export const dynamic = "force-dynamic";

/** One tenant's accounts: staff roster + resident accounts. */
export default async function PlatformAgencyPage({ params }: { params: Promise<{ slug: string }> }) {
  await requirePlatformAdmin();
  const { slug } = await params;
  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  if (!agency) notFound();

  const [users, requesters, requests, directory, allAgencies] = await Promise.all([
    repo.listUsers(agency.id),
    repo.listRequesters(agency.id),
    repo.listRequests(agency.id),
    repo.listDirectory(agency.id),
    repo.listAgencies(),
  ]);
  const requestCountByRequester = new Map<string, number>();
  for (const r of requests) {
    if (r.requesterId)
      requestCountByRequester.set(r.requesterId, (requestCountByRequester.get(r.requesterId) ?? 0) + 1);
  }

  const staffRows: PlatformStaffRow[] = users
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email))
    .map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, hasPassword: u.passwordHash != null }));

  const residentAccounts = requesters.filter((r) => r.passwordHash);
  const emailOnly = requesters.filter((r) => !r.passwordHash && r.email);

  const directoryRows: DirectoryLinkRow[] = directory.map((d) => ({
    id: d.id,
    name: d.name,
    jurisdictionType: d.jurisdictionType,
    peerAgencyId: d.peerAgencyId,
  }));
  const peerAgencies = allAgencies
    .filter((a) => a.id !== agency.id)
    .map((a) => ({ id: a.id, name: a.name, slug: a.slug }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="wrap" style={{ maxWidth: 860, paddingBlock: "36px" }}>
      <Link href="/admin" className="muted" style={{ fontSize: "0.9rem" }}>
        ← All agencies
      </Link>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "1.7rem" }}>{agency.name}</h1>
        <span className="mono muted">/{agency.slug}</span>
        <span className="tag">{agency.stateCode}</span>
        <Link href={`/${agency.slug}`} className="btn btn-sm" style={{ marginLeft: "auto" }}>
          Open portal ↗
        </Link>
      </div>

      <h2 style={{ fontSize: "1.1rem", marginTop: 26, marginBottom: 10 }}>Staff accounts</h2>
      <PlatformStaffTable agencyId={agency.id} agencySlug={agency.slug} rows={staffRows} />

      <h2 style={{ fontSize: "1.1rem", marginTop: 28, marginBottom: 10 }}>
        Referral directory — tenant links
      </h2>
      <DirectoryPeerLinks
        agencyId={agency.id}
        agencySlug={agency.slug}
        entries={directoryRows}
        agencies={peerAgencies}
      />

      <h2 style={{ fontSize: "1.1rem", marginTop: 28, marginBottom: 10 }}>
        Resident accounts{" "}
        <span className="muted" style={{ fontWeight: 400, fontSize: "0.9rem" }}>
          · {residentAccounts.length} registered, {emailOnly.length} email-only
        </span>
      </h2>
      <div className="card" style={{ overflow: "hidden" }}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {residentAccounts.map((r) => (
            <li key={r.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
              <Avatar name={r.name ?? r.email ?? "?"} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{r.name ?? r.email}</div>
                <div className="muted" style={{ fontSize: "0.82rem" }}>
                  {r.email}
                </div>
              </div>
              <span className="tag">{requestCountByRequester.get(r.id) ?? 0} requests</span>
            </li>
          ))}
          {residentAccounts.length === 0 && (
            <li className="muted" style={{ padding: 16 }}>
              No registered resident accounts yet.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
