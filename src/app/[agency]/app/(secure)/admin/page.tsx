import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import { requireStaff } from "@/auth/guards";
import { StaffRoster, type RosterRow } from "../../../../_components/StaffRoster";
import { WorkflowSettingsPanel } from "../../../../_components/WorkflowSettingsPanel";
import { RoutingRulesPanel } from "../../../../_components/RoutingRulesPanel";
import { DepartmentManager, type DepartmentRow } from "../../../../_components/DepartmentManager";
import { effectiveWorkflowSettings } from "@/domain/workflow";
import { computeSetupStatus } from "@/domain/setupChecklist";
import { getStateProfile } from "@/statute/profiles";
import { getEmailSender } from "@/adapters/email";

export const dynamic = "force-dynamic";

export default async function AdminPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) notFound(); // demo fixture has no accounts to manage
  const staff = await requireStaff(slug, ["admin"]);

  const repo = await getRepository();
  const [users, activity, agencyRow, departments, directory, publicDocs, requests] =
    await Promise.all([
      repo.listUsers(agency.id),
      repo.listAdminEvents(agency.id, 20),
      repo.getAgency(agency.id),
      repo.listDepartments(agency.id),
      repo.listDirectory(agency.id),
      repo.listPublicDocuments(agency.id),
      repo.listRequests(agency.id),
    ]);

  // Go-live checklist — computed from what exists, never manually ticked.
  const setup = computeSetupStatus({
    staffCount: users.length,
    departmentCount: departments.length,
    routingRuleCount: (agencyRow?.defaultRoutingRules ?? []).length,
    directoryCount: directory.length,
    publicRecordCount: publicDocs.length,
    requestCount: requests.length,
    hasStatuteProfile: agencyRow ? getStateProfile(agencyRow.stateCode) != null : false,
    emailConfigured: getEmailSender() != null,
  });
  const workflow = effectiveWorkflowSettings(agencyRow?.workflowSettings);
  const ruleKeywords = Object.fromEntries(
    (agencyRow?.defaultRoutingRules ?? []).map((r) => [r.departmentId, r.keywords.join(", ")]),
  );
  const rows: RosterRow[] = await Promise.all(
    users
      .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email))
      .map(async (u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        isSelf: u.id === staff.userId,
        hasPassword: u.passwordHash != null,
        departmentIds: await repo.listUserDepartmentIds(staff.agencyId, u.id),
      })),
  );

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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={`/${slug}/app/admin/directory`} className="btn btn-sm">
            Referral directory
          </Link>
          <Link href={`/${slug}/app/admin/import`} className="btn btn-sm">
            Import legacy requests
          </Link>
        </div>
      </div>
      {/* Go-live checklist — shown until the office is actually set up.
          Every line is computed from real state; nothing here is a manual
          tick-box that can lie. */}
      {!setup.complete && (
        <div className="card card-pad" style={{ marginBottom: 24, borderLeft: "3px solid var(--accent)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div className="panel-title">Go-live checklist</div>
            <span className="pill" style={{ marginLeft: "auto" }}>
              {setup.doneCount} of {setup.totalCount} done
            </span>
            {setup.requiredRemaining > 0 && (
              <span className="pill band-overdue">
                {setup.requiredRemaining} required step{setup.requiredRemaining === 1 ? "" : "s"} left
              </span>
            )}
          </div>
          <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 10 }}>
            {setup.steps.map((step) => (
              <li key={step.key} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span
                  aria-hidden
                  style={{
                    fontWeight: 700,
                    color: step.done ? "var(--ok)" : step.required ? "var(--overdue)" : "var(--ink-2)",
                    width: 18,
                    textAlign: "center",
                  }}
                >
                  {step.done ? "✓" : "○"}
                </span>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <span style={{ fontWeight: 600, fontSize: "0.92rem" }}>
                    {step.title}
                    {step.required && !step.done && (
                      <span className="muted" style={{ fontWeight: 400 }}> — required</span>
                    )}
                  </span>
                  <div className="muted" style={{ fontSize: "0.82rem" }}>{step.detail}</div>
                </div>
                {!step.done && step.href && (
                  <a className="btn btn-sm" href={`/${slug}/app/${step.href}`}>
                    Set up →
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <StaffRoster
        agencySlug={slug}
        rows={rows}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
      />

      <h2 id="departments" style={{ fontSize: "1.1rem", marginTop: 28, marginBottom: 10 }}>
        Departments
      </h2>
      <p className="muted" style={{ fontSize: "0.9rem", marginBottom: 12, maxWidth: 560 }}>
        The custodians requests get dispatched to. Each department can fulfill from a no-login
        email link, or its responders can sign in and see their tasks.
      </p>
      <DepartmentManager
        agencySlug={slug}
        rows={departments.map(
          (d): DepartmentRow => ({ id: d.id, name: d.name, responderEmails: d.defaultResponderEmails }),
        )}
      />

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
