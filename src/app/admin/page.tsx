import Link from "next/link";
import { requirePlatformAdmin } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { CreateAgencyForm } from "../_components/PlatformConsole";
import { Seal } from "../_components/ui";
import { platformSignOut } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Operator home — the deployment at a glance. The operator's actual jobs, in
 * order: (1) spot a tenant in trouble (overdue requests) before its clerk
 * calls, (2) jump into a tenant to help, (3) onboard the next one. The layout
 * follows that order: health strip → tenant cards → onboarding.
 */
export default async function PlatformHome() {
  await requirePlatformAdmin();
  const repo = await getRepository();
  const agencies = await repo.listAgencies();
  const now = new Date();

  const rows = await Promise.all(
    agencies
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (a) => {
        const [requests, users, requesters, directory] = await Promise.all([
          repo.listRequests(a.id),
          repo.listUsers(a.id),
          repo.listRequesters(a.id),
          repo.listDirectory(a.id),
        ]);
        const open = requests.filter((r) => r.closedAt == null);
        const overdue = open.filter(
          (r) => r.statutoryDueAt != null && r.statutoryDueAt.getTime() < now.getTime(),
        );
        return {
          agency: a,
          open: open.length,
          overdue: overdue.length,
          total: requests.length,
          staff: users.length,
          residents: requesters.filter((r) => r.passwordHash).length,
          peerLinks: directory.filter((d) => d.peerAgencyId).length,
        };
      }),
  );

  const totals = rows.reduce(
    (t, r) => ({
      open: t.open + r.open,
      overdue: t.overdue + r.overdue,
      staff: t.staff + r.staff,
      residents: t.residents + r.residents,
    }),
    { open: 0, overdue: 0, staff: 0, residents: 0 },
  );

  return (
    <div className="wrap" style={{ maxWidth: 920, paddingBlock: "36px 48px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <span className="eyebrow">Platform console</span>
          <h1 className="serif" style={{ fontSize: "1.9rem", marginTop: 6, fontWeight: 600 }}>
            This deployment
          </h1>
        </div>
        <form action={platformSignOut}>
          <button className="btn btn-sm btn-ghost" type="submit">
            Sign out
          </button>
        </form>
      </div>

      {/* Deployment health — the number that matters is Overdue. */}
      <div className="stat-row" style={{ marginTop: 20, gridTemplateColumns: "repeat(5, 1fr)" }}>
        <div className="stat">
          <div className="stat-num">{rows.length}</div>
          <div className="stat-label">{rows.length === 1 ? "Agency" : "Agencies"}</div>
        </div>
        <div className="stat">
          <div className="stat-num">{totals.open}</div>
          <div className="stat-label">Open requests</div>
        </div>
        <div className="stat">
          <div className="stat-num" style={{ color: totals.overdue ? "var(--overdue)" : undefined }}>
            {totals.overdue}
          </div>
          <div className="stat-label">Overdue</div>
        </div>
        <div className="stat">
          <div className="stat-num">{totals.staff}</div>
          <div className="stat-label">Staff accounts</div>
        </div>
        <div className="stat">
          <div className="stat-num">{totals.residents}</div>
          <div className="stat-label">Resident accounts</div>
        </div>
      </div>

      <h2 style={{ fontSize: "1.05rem", marginTop: 30, marginBottom: 12 }}>Agencies</h2>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}>
        {rows.map(({ agency, open, overdue, total, staff, residents, peerLinks }) => (
          <article key={agency.id} className="card card-pad hover-lift" style={{ display: "grid", gap: 12, alignContent: "start" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <Seal size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="serif" style={{ fontWeight: 600, fontSize: "1.12rem" }}>
                  {agency.name}
                </div>
                <div className="muted mono" style={{ fontSize: "0.78rem" }}>
                  /{agency.slug} · {agency.stateCode}
                </div>
              </div>
              {overdue > 0 ? (
                <span className="pill band-overdue">{overdue} overdue</span>
              ) : (
                <span className="pill band-on_track">On track</span>
              )}
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span className="tag">
                {open} open · {total} all-time
              </span>
              <span className="tag">{staff} staff</span>
              <span className="tag">{residents} residents</span>
              {peerLinks > 0 && (
                <span className="tag" title="Directory entries linked to other tenants — referrals forward directly">
                  ⚡ {peerLinks} forwarding link{peerLinks === 1 ? "" : "s"}
                </span>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href={`/admin/${agency.slug}`} className="btn btn-sm btn-primary">
                Manage
              </Link>
              <Link href={`/${agency.slug}`} className="btn btn-sm">
                Portal ↗
              </Link>
              <Link href={`/${agency.slug}/app`} className="btn btn-sm">
                Workspace ↗
              </Link>
            </div>
          </article>
        ))}
        {rows.length === 0 && (
          <p className="muted" style={{ padding: 4 }}>
            No agencies yet — onboard the first one below.
          </p>
        )}
      </div>

      <h2 style={{ fontSize: "1.05rem", marginTop: 34, marginBottom: 12 }}>Onboard an agency</h2>
      <CreateAgencyForm />
    </div>
  );
}
