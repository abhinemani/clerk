import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import { requireRequester } from "@/auth/guards";
import { dateShort } from "@/lib/format";
import { StatusPill } from "../../_components/ui";
import { portalSignOut } from "../actions";

export const dynamic = "force-dynamic";

/** Resident-facing status labels (no jargon). */
const STATUS_LABEL: Record<string, string> = {
  submitted: "Received",
  in_review: "Under review",
  clarification_needed: "Needs your reply",
  in_progress: "Gathering records",
  records_review: "Almost ready",
  partially_fulfilled: "Partially released",
  fulfilled: "Records ready",
  denied: "Denied",
  withdrawn: "Withdrawn",
  closed: "Closed",
};

export default async function AccountPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency) notFound();
  const session = await requireRequester(slug);

  const repo = await getRepository();
  const requester = agency.id ? await repo.getRequester(agency.id, session.requesterId) : null;
  // Claimed history stays hidden until the email is proven (see accountService).
  const verified = requester?.emailVerifiedAt != null;
  const requests =
    agency.id && verified ? await repo.listRequestsByRequester(agency.id, session.requesterId) : [];

  return (
    <div className="wrap" style={{ maxWidth: 760, paddingBlock: "40px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <span className="eyebrow">{agency.name} · Public Records</span>
          <h1 style={{ fontSize: "1.9rem", marginTop: 6, fontWeight: 600 }}>
            {session.name ? `Welcome, ${session.name.split(" ")[0]}` : "My requests"}
          </h1>
        </div>
        <form action={portalSignOut.bind(null, slug)}>
          <button className="btn btn-sm btn-ghost" type="submit">
            Sign out
          </button>
        </form>
      </div>

      <div className="card card-pad" style={{ marginTop: 18, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="panel-title">Account</div>
          <div style={{ fontWeight: 600, marginTop: 6 }}>{session.name ?? "—"}</div>
          <div className="muted" style={{ fontSize: "0.9rem" }}>
            {session.email}
          </div>
        </div>
        <Link href={`/${agency.slug}/request`} className="btn btn-primary">
          File a new request
        </Link>
      </div>

      <h2 style={{ fontSize: "1.15rem", marginTop: 28, marginBottom: 12 }}>
        Your requests{" "}
        <span className="muted" style={{ fontWeight: 400, fontSize: "0.9rem" }}>
          · {requests.length}
        </span>
      </h2>

      {!verified ? (
        <div className="card card-pad" style={{ borderColor: "var(--due-border)", background: "var(--due-bg)" }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Verify your email to see your requests.</p>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.92rem" }}>
            We sent a verification link to {session.email}. Requests filed with this email stay
            hidden until you confirm the address is yours.
          </p>
        </div>
      ) : requests.length === 0 ? (
        <div className="card card-pad">
          <p className="muted" style={{ margin: 0 }}>
            No requests yet. Anything you file while signed in — or filed earlier with this email —
            shows up here.
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {requests.map((r) => (
              <li
                key={r.id}
                style={{ display: "flex", gap: 14, alignItems: "center", padding: "16px 18px", borderBottom: "1px solid var(--border)" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.interpretedScope ?? r.rawText}
                  </div>
                  <div className="muted mono" style={{ fontSize: "0.78rem", marginTop: 4 }}>
                    {r.publicId} · filed {dateShort(r.receivedAt ?? r.createdAt)}
                    {r.statutoryDueAt ? ` · due ${dateShort(r.statutoryDueAt)}` : ""}
                  </div>
                </div>
                <StatusPill label={STATUS_LABEL[r.status] ?? r.status} />
                <Link href={`/${agency.slug}/track?id=${r.publicId}`} className="btn btn-sm">
                  Track
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
