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
import { Avatar, Seal } from "../../_components/ui";

export const dynamic = "force-dynamic";

/**
 * One tenant, for the operator: health first, then the levers they actually
 * pull — staff accounts, forwarding links, resident accounts.
 */
export default async function PlatformAgencyPage({ params }: { params: Promise<{ slug: string }> }) {
  await requirePlatformAdmin();
  const { slug } = await params;
  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  if (!agency) notFound();

  const now = new Date();
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

  const open = requests.filter((r) => r.closedAt == null);
  const overdue = open.filter(
    (r) => r.statutoryDueAt != null && r.statutoryDueAt.getTime() < now.getTime(),
  );
  const closed = requests.filter((r) => r.closedAt != null);
  const closedOnTime = closed.filter(
    (r) => r.statutoryDueAt == null || r.closedAt!.getTime() <= r.statutoryDueAt.getTime(),
  );
  const onTimeRate = closed.length === 0 ? null : Math.round((closedOnTime.length / closed.length) * 100);

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
    <div className="wrap" style={{ maxWidth: 920, paddingBlock: "var(--page-top) var(--page-bottom)" }}>
      <Link href="/admin" className="muted" style={{ fontSize: "0.9rem" }}>
        ← All agencies
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14, flexWrap: "wrap" }}>
        <Seal size={44} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 className="serif" style={{ fontSize: "1.8rem", fontWeight: 600 }}>
            {agency.name}
          </h1>
          <div className="muted mono" style={{ fontSize: "0.82rem", marginTop: 2 }}>
            /{agency.slug} · {agency.stateCode} statute profile
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={`/${agency.slug}`} className="btn btn-sm">
            Portal ↗
          </Link>
          <Link href={`/${agency.slug}/app`} className="btn btn-sm">
            Workspace ↗
          </Link>
        </div>
      </div>

      <div className="stat-row" style={{ marginTop: 20, gridTemplateColumns: "repeat(5, 1fr)" }}>
        <div className="stat">
          <div className="stat-num">{open.length}</div>
          <div className="stat-label">Open requests</div>
        </div>
        <div className="stat">
          <div className="stat-num" style={{ color: overdue.length ? "var(--overdue)" : undefined }}>
            {overdue.length}
          </div>
          <div className="stat-label">Overdue</div>
        </div>
        <div className="stat">
          <div className="stat-num">{onTimeRate == null ? "—" : `${onTimeRate}%`}</div>
          <div className="stat-label">On-time closures</div>
        </div>
        <div className="stat">
          <div className="stat-num">{staffRows.length}</div>
          <div className="stat-label">Staff accounts</div>
        </div>
        <div className="stat">
          <div className="stat-num">{residentAccounts.length}</div>
          <div className="stat-label">Resident accounts</div>
        </div>
      </div>

      <h2 style={{ fontSize: "1.05rem", marginTop: 30, marginBottom: 10 }}>Staff accounts</h2>
      <PlatformStaffTable agencyId={agency.id} agencySlug={agency.slug} rows={staffRows} />

      <h2 style={{ fontSize: "1.05rem", marginTop: 30, marginBottom: 10 }}>
        Referral directory — tenant links
      </h2>
      <DirectoryPeerLinks
        agencyId={agency.id}
        agencySlug={agency.slug}
        entries={directoryRows}
        agencies={peerAgencies}
      />

      <h2 style={{ fontSize: "1.05rem", marginTop: 30, marginBottom: 10 }}>
        Resident accounts{" "}
        <span className="muted" style={{ fontWeight: 400, fontSize: "0.9rem" }}>
          · {residentAccounts.length} registered, {emailOnly.length} email-only
        </span>
      </h2>
      <div className="card" style={{ overflow: "hidden" }}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {residentAccounts.map((r) => (
            <li
              key={r.id}
              style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--border)" }}
            >
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
