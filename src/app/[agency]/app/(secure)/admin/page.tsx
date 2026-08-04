import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import { requireStaff } from "@/auth/guards";
import { StaffRoster, type RosterRow } from "../../../../_components/StaffRoster";
import { WorkflowSettingsPanel } from "../../../../_components/WorkflowSettingsPanel";
import { RoutingRulesPanel } from "../../../../_components/RoutingRulesPanel";
import { effectiveWorkflowSettings } from "@/domain/workflow";

export const dynamic = "force-dynamic";

export default async function AdminPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) notFound(); // demo fixture has no accounts to manage
  const staff = await requireStaff(slug, ["admin"]);

  const repo = await getRepository();
  const [users, activity, agencyRow, departments] = await Promise.all([
    repo.listUsers(agency.id),
    repo.listAdminEvents(agency.id, 20),
    repo.getAgency(agency.id),
    repo.listDepartments(agency.id),
  ]);
  const workflow = effectiveWorkflowSettings(agencyRow?.workflowSettings);
  const ruleKeywords = Object.fromEntries(
    (agencyRow?.defaultRoutingRules ?? []).map((r) => [r.departmentId, r.keywords.join(", ")]),
  );
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
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "1.7rem", marginTop: 6, marginBottom: 6 }}>Staff accounts</h1>
          <p className="muted" style={{ marginBottom: 20, maxWidth: 560 }}>
            Who can work records for the {agency.name}, and what they can do. Admins manage this
            roster; coordinators run requests; responders only see tasks shared with them.
          </p>
        </div>
        <Link href={`/${slug}/app/admin/import`} className="btn btn-sm">
          Import legacy requests
        </Link>
      </div>
      <StaffRoster agencySlug={slug} rows={rows} />

      <h2 style={{ fontSize: "1.1rem", marginTop: 28, marginBottom: 10 }}>Workflow automation</h2>
      <WorkflowSettingsPanel
        key={`${workflow.autoAssign}|${workflow.autoDispatch}|${workflow.autoDispatchConfidence}|${workflow.milestoneEmails}`}
        agencySlug={slug}
        initial={workflow}
      />

      <h2 style={{ fontSize: "1.1rem", marginTop: 28, marginBottom: 10 }}>Department routing rules</h2>
      <RoutingRulesPanel
        key={JSON.stringify(ruleKeywords)}
        agencySlug={slug}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        initial={ruleKeywords}
      />

      <h2 style={{ fontSize: "1.1rem", marginTop: 28, marginBottom: 10 }}>
        Account activity{" "}
        <span className="muted" style={{ fontWeight: 400, fontSize: "0.85rem" }}>
          · append-only audit
        </span>
      </h2>
      <div className="card" style={{ overflow: "hidden" }}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {activity.map((e) => (
            <li
              key={e.id}
              style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "10px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}
            >
              <span className="tag">{e.kind.replace(/_/g, " ")}</span>
              <span style={{ fontSize: "0.9rem", flex: 1, minWidth: 200 }}>{e.summary}</span>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                {e.actorLabel} · {e.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
            </li>
          ))}
          {activity.length === 0 && (
            <li className="muted" style={{ padding: 14, fontSize: "0.9rem" }}>
              No account activity recorded yet.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
