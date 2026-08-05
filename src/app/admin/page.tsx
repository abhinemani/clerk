import Link from "next/link";
import { requirePlatformAdmin } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { computeSetupStatus } from "@/domain/setupChecklist";
import { getStateProfile } from "@/statute/profiles";
import { getEmailSender } from "@/adapters/email";
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
        const [requests, users, requesters, directory, departments, publicDocs] =
          await Promise.all([
            repo.listRequests(a.id),
            repo.listUsers(a.id),
            repo.listRequesters(a.id),
            repo.listDirectory(a.id),
            repo.listDepartments(a.id),
            repo.listPublicDocuments(a.id),
          ]);
        const open = requests.filter((r) => r.closedAt == null);
        const overdue = open.filter(
          (r) => r.statutoryDueAt != null && r.statutoryDueAt.getTime() < now.getTime(),
        );
        const setup = computeSetupStatus({
          staffCount: users.length,
          departmentCount: departments.length,
          routingRuleCount: (a.defaultRoutingRules ?? []).length,
          directoryCount: directory.length,
          publicRecordCount: publicDocs.length,
          requestCount: requests.length,
          hasStatuteProfile: getStateProfile(a.stateCode) != null,
          emailConfigured: getEmailSender() != null,
        });
        return {
          agency: a,
          open: open.length,
          overdue: overdue.length,
          total: requests.length,
          staff: users.length,
          residents: requesters.filter((r) => r.passwordHash).length,
          peerLinks: directory.filter((d) => d.peerAgencyId).length,
          setup,
        };
      }),
  );

  // Deployment health: failures must be VISIBLE, not console-only. Failed
  // jobs stay in the jobs table (durable queue); failed relays stay on their
  // outbox rows. Green means actually green.
  const [failedJobs, queuedJobs, failedDeliveries] = await Promise.all([
    repo.listJobs({ status: "failed", limit: 10 }),
    repo.listJobs({ status: "queued", limit: 100 }),
    repo.listFailedDeliveries(10),
  ]);
  const agencyNameById = new Map(agencies.map((a) => [a.id, a.name]));
  const oldestQueued = queuedJobs.at(-1); // listJobs is newest-first
  const oldestQueuedMin = oldestQueued
    ? Math.round((now.getTime() - oldestQueued.createdAt.getTime()) / 60_000)
    : null;
  const healthy = failedJobs.length === 0 && failedDeliveries.length === 0;

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

      {/* Health — jobs and email relays. A failure here is the operator's to
          see FIRST, not the clerk's to report. */}
      <h2 style={{ fontSize: "1.05rem", marginTop: 30, marginBottom: 12 }}>Health</h2>
      {healthy ? (
        <p className="pill band-on_track" style={{ display: "inline-flex" }}>
          ✓ All systems working — {queuedJobs.length} job{queuedJobs.length === 1 ? "" : "s"} queued
          {oldestQueuedMin != null && oldestQueuedMin > 5 ? ` (oldest ${oldestQueuedMin} min — worker may be stuck)` : ""}
          , no failed jobs, no failed email relays
        </p>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {failedJobs.length > 0 && (
            <div className="card card-pad" style={{ borderLeft: "3px solid var(--overdue)" }}>
              <div className="panel-title" style={{ color: "var(--overdue)" }}>
                Failed jobs · {failedJobs.length}
              </div>
              <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 }}>
                {failedJobs.map((j) => (
                  <li key={j.id} style={{ fontSize: "0.85rem" }}>
                    <span className="tag">{j.kind.replace(/_/g, " ")}</span>{" "}
                    <span className="muted">
                      {typeof j.payload.agencyId === "string"
                        ? (agencyNameById.get(j.payload.agencyId) ?? "unknown agency")
                        : "deployment"}{" "}
                      · {j.attempts} attempt{j.attempts === 1 ? "" : "s"} ·{" "}
                    </span>
                    <span className="mono" style={{ fontSize: "0.78rem" }}>
                      {(j.lastError ?? "unknown error").slice(0, 140)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {failedDeliveries.length > 0 && (
            <div className="card card-pad" style={{ borderLeft: "3px solid var(--overdue)" }}>
              <div className="panel-title" style={{ color: "var(--overdue)" }}>
                Failed email relays · {failedDeliveries.length}
              </div>
              <p className="muted" style={{ fontSize: "0.82rem", margin: "6px 0 0" }}>
                The outbox rows are kept — these messages were recorded but the provider refused
                them. Fix the provider, then re-send from each agency&apos;s outbox.
              </p>
              <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 }}>
                {failedDeliveries.map((d) => (
                  <li key={d.id} style={{ fontSize: "0.85rem" }}>
                    <span className="mono">{d.toEmail}</span>{" "}
                    <span className="muted">
                      · {agencyNameById.get(d.agencyId) ?? "unknown agency"} · {d.subject.slice(0, 60)} ·{" "}
                    </span>
                    <span className="mono" style={{ fontSize: "0.78rem", color: "var(--overdue)" }}>
                      {(d.relayError ?? "unknown error").slice(0, 100)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <h2 style={{ fontSize: "1.05rem", marginTop: 30, marginBottom: 12 }}>Agencies</h2>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}>
        {rows.map(({ agency, open, overdue, total, staff, residents, peerLinks, setup }) => (
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
              ) : !setup.complete ? (
                <span
                  className="pill band-due_soon"
                  title={`Go-live checklist: ${setup.doneCount} of ${setup.totalCount} steps done — see the agency's Manage staff page`}
                >
                  Setup {setup.doneCount}/{setup.totalCount}
                </span>
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
