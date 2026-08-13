import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import { requireStaff } from "@/auth/guards";
import { StaffRoster, type RosterRow } from "../../../../_components/StaffRoster";
import { WorkflowSettingsPanel } from "../../../../_components/WorkflowSettingsPanel";
import { RoutingRulesPanel } from "../../../../_components/RoutingRulesPanel";
import { DepartmentManager, type DepartmentRow } from "../../../../_components/DepartmentManager";
import { BrandingPanel } from "../../../../_components/BrandingPanel";
import { CompliancePanel, type StatuteVM } from "../../../../_components/CompliancePanel";
import { StatusApiPanel } from "../../../../_components/StatusApiPanel";
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
    statuteReviewed: agencyRow?.settings?.statuteReview != null,
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

  const sections = [
    { id: "team", label: "Team" },
    { id: "departments", label: "Departments" },
    { id: "branding", label: "Branding" },
    { id: "compliance", label: "Compliance" },
    { id: "automation", label: "Automation" },
    { id: "routing", label: "Routing rules" },
    { id: "activity", label: "Activity" },
  ];
  const branding = agencyRow?.branding ?? {};
  const agencySettings = agencyRow?.settings ?? {};
  const profile = agencyRow ? getStateProfile(agencyRow.stateCode) : undefined;
  const statuteVM: StatuteVM | null = profile
    ? {
        stateName: profile.stateName,
        initialDays: profile.responseClock.initialDays,
        dayType: profile.responseClock.dayType,
        extensionMaxDays: profile.responseClock.extension.allowed
          ? profile.responseClock.extension.maxDays
          : null,
        exemptionCount: profile.exemptions.length,
        review: agencySettings.statuteReview ?? null,
      }
    : null;

  return (
    <div className="wrap" style={{ maxWidth: 820, paddingBlock: "36px 48px" }}>
      <Link href={`/${slug}/app`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Command center
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 12 }}>
        {agency.name} · Administration
      </span>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="serif" style={{ fontSize: "1.8rem", marginTop: 6, marginBottom: 6, fontWeight: 600 }}>
            Run your records office
          </h1>
          <p className="muted" style={{ marginBottom: 8, maxWidth: 560 }}>
            The levers behind the workspace: who works requests, which departments hold records,
            and what happens automatically. Every change here lands in the audit log.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={`/${slug}/app/admin/directory`} className="btn btn-sm">
            Referral directory
          </Link>
          <Link href={`/${slug}/app/admin/records-import`} className="btn btn-sm">
            Import records
          </Link>
          <Link href={`/${slug}/app/admin/sources`} className="btn btn-sm">
            Connected data sources
          </Link>
          <Link href={`/${slug}/app/admin/import`} className="btn btn-sm">
            Import legacy requests
          </Link>
        </div>
      </div>

      {/* Section index — one glance, one click to any lever. */}
      <nav aria-label="Admin sections" style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 22px" }}>
        {sections.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="tag" style={{ textDecoration: "none" }}>
            {s.label}
          </a>
        ))}
      </nav>

      {/* Go-live checklist — shown until the office is actually set up.
          Every line is computed from real state; nothing here is a manual
          tick-box that can lie. */}
      {setup.complete && (
        <p className="pill band-on_track" style={{ marginBottom: 22 }}>
          ✓ Go-live checklist complete — all {setup.totalCount} setup steps done
        </p>
      )}
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

      <h2 id="team" style={{ fontSize: "1.1rem", marginTop: 30, marginBottom: 8, scrollMarginTop: 80 }}>
        Team
      </h2>
      <p className="muted" style={{ fontSize: "0.9rem", marginBottom: 12, maxWidth: 560 }}>
        Admins manage this roster; coordinators run requests; responders sign in and see only their
        departments&apos; tasks.
      </p>
      <StaffRoster
        agencySlug={slug}
        rows={rows}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
      />

      <h2 id="departments" style={{ fontSize: "1.1rem", marginTop: 30, marginBottom: 8, scrollMarginTop: 80 }}>
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

      <h2 id="branding" style={{ fontSize: "1.1rem", marginTop: 30, marginBottom: 8, scrollMarginTop: 80 }}>
        Portal branding
      </h2>
      <p className="muted" style={{ fontSize: "0.9rem", marginBottom: 12, maxWidth: 560 }}>
        Make the portal yours: your seal, your accent color, your office details in the footer.
        Residents should recognize their government, not a vendor.
      </p>
      <BrandingPanel
        agencySlug={slug}
        initial={{
          officeName: branding.officeName ?? "",
          contactEmail: branding.contactEmail ?? "",
          addressLines: (branding.addressLines ?? []).join("\n"),
          hours: branding.hours ?? "",
          accentColor: branding.accentColor ?? "",
          hasCustomSeal: branding.sealBlobRef != null,
        }}
      />

      <h2 id="compliance" style={{ fontSize: "1.1rem", marginTop: 30, marginBottom: 8, scrollMarginTop: 80 }}>
        Compliance
      </h2>
      <p className="muted" style={{ fontSize: "0.9rem", marginBottom: 12, maxWidth: 560 }}>
        The statute your deadlines run on — and whether your counsel has verified it — plus the
        public request log residents and the council can check.
      </p>
      <CompliancePanel
        agencySlug={slug}
        statute={statuteVM}
        logEnabled={agencySettings.publicRequestLog === true}
      />
      <div style={{ marginTop: 12 }}>
        <StatusApiPanel
          agencySlug={slug}
          enabled={agencySettings.statusApi?.enabled === true}
          webhookUrl={agencySettings.statusApi?.webhookUrl ?? null}
        />
      </div>

      <h2 id="automation" style={{ fontSize: "1.1rem", marginTop: 30, marginBottom: 8, scrollMarginTop: 80 }}>
        Workflow automation
      </h2>
      <p className="muted" style={{ fontSize: "0.9rem", marginBottom: 12, maxWidth: 560 }}>
        Opt-in, per-agency. Auto-assignment balances new requests across coordinators;
        confidence-gated auto-dispatch sends obvious routings out unattended. Everything stays
        audited and reversible.
      </p>
      <WorkflowSettingsPanel
        key={`${workflow.autoAssign}|${workflow.autoDispatch}|${workflow.autoDispatchConfidence}|${workflow.milestoneEmails}`}
        agencySlug={slug}
        initial={workflow}
      />

      <h2 id="routing" style={{ fontSize: "1.1rem", marginTop: 30, marginBottom: 8, scrollMarginTop: 80 }}>
        Department routing rules
      </h2>
      <p className="muted" style={{ fontSize: "0.9rem", marginBottom: 12, maxWidth: 560 }}>
        Deterministic keyword rules — &ldquo;pothole&rdquo; goes to Public Works the moment it&apos;s
        filed, no AI key required.
      </p>
      <RoutingRulesPanel
        key={JSON.stringify(ruleKeywords)}
        agencySlug={slug}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        initial={ruleKeywords}
      />

      <h2 id="activity" style={{ fontSize: "1.1rem", marginTop: 30, marginBottom: 10, scrollMarginTop: 80 }}>
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
