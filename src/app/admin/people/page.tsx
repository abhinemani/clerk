import Link from "next/link";
import { requirePlatformAdmin } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { Avatar } from "../../_components/ui";

export const dynamic = "force-dynamic";

/**
 * Cross-tenant people search — the operator's answer to "which tenants does
 * jane@city.gov have accounts in?". Read-only on purpose: management actions
 * (role, reset, revoke) live on each agency's own console page, where the
 * tenant context is unambiguous.
 */
export default async function PlatformPeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requirePlatformAdmin();
  const { q } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();
  const repo = await getRepository();
  const agencies = (await repo.listAgencies()).sort((a, b) => a.name.localeCompare(b.name));

  const matches = (email: string | null, name: string | null) =>
    query.length > 0 &&
    ((email ?? "").toLowerCase().includes(query) || (name ?? "").toLowerCase().includes(query));

  const groups = query
    ? (
        await Promise.all(
          agencies.map(async (agency) => {
            const [users, requesters] = await Promise.all([
              repo.listUsers(agency.id),
              repo.listRequesters(agency.id),
            ]);
            return {
              agency,
              staff: users
                .filter((u) => matches(u.email, u.name))
                .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email)),
              requesters: requesters
                .filter((r) => matches(r.email, r.name))
                .sort((a, b) => (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "")),
            };
          }),
        )
      ).filter((g) => g.staff.length > 0 || g.requesters.length > 0)
    : [];
  const hits = groups.reduce((n, g) => n + g.staff.length + g.requesters.length, 0);

  return (
    <div className="wrap" style={{ maxWidth: 920, paddingBlock: "var(--page-top) var(--page-bottom)" }}>
      <Link href="/admin" className="muted" style={{ fontSize: "0.9rem" }}>
        ← All agencies
      </Link>

      <div style={{ marginTop: 14 }}>
        <span className="eyebrow">Platform console</span>
        <h1 className="serif" style={{ fontSize: "1.9rem", marginTop: 6, fontWeight: 600 }}>
          People
        </h1>
        <p className="muted" style={{ marginTop: 6, fontSize: "0.92rem" }}>
          Every staff and resident account on this deployment, searched across all{" "}
          {agencies.length} {agencies.length === 1 ? "agency" : "agencies"} at once. Accounts are
          agency-scoped — the same email at two agencies is two separate accounts.
        </p>
      </div>

      <form method="get" style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          type="search"
          name="q"
          className="field"
          style={{ flex: 1, minWidth: 240, maxWidth: 460 }}
          placeholder="Search by name or email…"
          defaultValue={q ?? ""}
          aria-label="Search people by name or email"
        />
        <button className="btn btn-primary" type="submit">
          Search
        </button>
      </form>

      {query && (
        <p className="muted" style={{ marginTop: 14, fontSize: "0.88rem" }}>
          {hits === 0
            ? `No accounts match "${q}".`
            : `${hits} account${hits === 1 ? "" : "s"} across ${groups.length} ${groups.length === 1 ? "agency" : "agencies"}.`}
        </p>
      )}

      {groups.map(({ agency, staff, requesters }) => (
        <section key={agency.id} style={{ marginTop: 22 }}>
          <h2 style={{ fontSize: "1.02rem", marginBottom: 8, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            {agency.name}
            <span className="muted mono" style={{ fontWeight: 400, fontSize: "0.78rem" }}>
              /{agency.slug}
            </span>
            <Link href={`/admin/${agency.slug}`} className="btn btn-sm" style={{ marginLeft: "auto" }}>
              Manage agency
            </Link>
          </h2>
          <div className="card" style={{ overflow: "hidden" }}>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {staff.map((u) => (
                <li
                  key={u.id}
                  style={{ display: "flex", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}
                >
                  <Avatar name={u.name ?? u.email} tone="primary" />
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 600 }}>{u.name ?? u.email}</div>
                    <div className="muted" style={{ fontSize: "0.8rem" }}>
                      {u.email}
                    </div>
                  </div>
                  <span className="tag">staff · {u.role.replace(/_/g, " ")}</span>
                  {!u.passwordHash && <span className="pill band-due_soon">invite pending</span>}
                </li>
              ))}
              {requesters.map((r) => (
                <li
                  key={r.id}
                  style={{ display: "flex", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}
                >
                  <Avatar name={r.name ?? r.email ?? "?"} />
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 600 }}>{r.name ?? r.email}</div>
                    <div className="muted" style={{ fontSize: "0.8rem" }}>
                      {r.email ?? "no email on file"}
                    </div>
                  </div>
                  <span className="tag">{r.passwordHash ? "resident account" : "email-only requester"}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}

      {!query && (
        <p className="muted" style={{ marginTop: 18, fontSize: "0.9rem" }}>
          Type a name or email above — results group by agency, with a jump to each agency&apos;s
          management page.
        </p>
      )}
    </div>
  );
}
