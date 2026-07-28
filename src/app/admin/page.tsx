import Link from "next/link";
import { requirePlatformAdmin } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { CreateAgencyForm } from "../_components/PlatformConsole";
import { Seal } from "../_components/ui";
import { platformSignOut } from "./actions";

export const dynamic = "force-dynamic";

/** Operator home: every tenant on this deployment, plus onboarding. */
export default async function PlatformHome() {
  await requirePlatformAdmin();
  const repo = await getRepository();
  const agencies = await repo.listAgencies();

  const rows = await Promise.all(
    agencies
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (a) => {
        const [requests, users, requesters] = await Promise.all([
          repo.listRequests(a.id),
          repo.listUsers(a.id),
          repo.listRequesters(a.id),
        ]);
        return {
          agency: a,
          requests: requests.length,
          staff: users.length,
          residents: requesters.filter((r) => r.passwordHash).length,
        };
      }),
  );

  return (
    <div className="wrap" style={{ maxWidth: 860, paddingBlock: "36px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <span className="eyebrow">Platform console</span>
          <h1 style={{ fontSize: "1.7rem", marginTop: 6 }}>Agencies</h1>
        </div>
        <form action={platformSignOut}>
          <button className="btn btn-sm btn-ghost" type="submit">
            Sign out
          </button>
        </form>
      </div>

      <div className="card" style={{ overflow: "hidden", marginTop: 18 }}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map(({ agency, requests, staff, residents }) => (
            <li
              key={agency.id}
              style={{ display: "flex", gap: 14, alignItems: "center", padding: "16px 18px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}
            >
              <Seal size={34} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600 }}>{agency.name}</div>
                <div className="muted mono" style={{ fontSize: "0.78rem" }}>
                  /{agency.slug} · {agency.stateCode}
                </div>
              </div>
              <span className="tag">{requests} requests</span>
              <span className="tag">{staff} staff</span>
              <span className="tag">{residents} resident accounts</span>
              <Link href={`/${agency.slug}`} className="btn btn-sm">
                Portal ↗
              </Link>
              <Link href={`/admin/${agency.slug}`} className="btn btn-sm btn-primary">
                Manage
              </Link>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="muted" style={{ padding: 18 }}>
              No agencies yet — onboard the first one below.
            </li>
          )}
        </ul>
      </div>

      <div style={{ marginTop: 24 }}>
        <CreateAgencyForm />
      </div>
    </div>
  );
}
