import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import { requireStaff } from "@/auth/guards";
import { dateShort } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The outbox — every outbound message the system produced (task dispatches,
 * reminders, verifications, resets, invites). In dev this IS the mailbox:
 * open a delivery to find its no-login or verification link.
 */
export default async function OutboxPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) notFound();
  await requireStaff(slug);

  const repo = await getRepository();
  const deliveries = await repo.listDeliveries(agency.id, 100);

  return (
    <div className="wrap" style={{ maxWidth: 820, paddingBlock: "var(--page-top) var(--page-bottom)" }}>
      <Link href={`/${slug}/app`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Command center
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 12 }}>
        {agency.name} · Deliveries
      </span>
      <h1 style={{ fontSize: "1.7rem", marginTop: 6, marginBottom: 6 }}>Outbox</h1>
      <p className="muted" style={{ marginBottom: 20, maxWidth: 560 }}>
        Every message this system sent (or would send, in development) — the audit of who was told
        what, when. Task links and verification links live inside their messages.
      </p>

      <div className="stack" style={{ gap: 12 }}>
        {deliveries.map((d) => (
          <details key={d.id} className="card" style={{ overflow: "hidden" }}>
            <summary
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                padding: "13px 16px",
                cursor: "pointer",
                listStyle: "none",
                flexWrap: "wrap",
              }}
            >
              <span className="pill pill-ai">{d.kind.replace(/_/g, " ")}</span>
              <span style={{ fontWeight: 600, flex: 1, minWidth: 200 }}>{d.subject}</span>
              <span className="muted" style={{ fontSize: "0.82rem" }}>
                → {d.toEmail} · {dateShort(d.createdAt)}
              </span>
            </summary>
            <pre
              style={{
                margin: 0,
                padding: "14px 18px",
                borderTop: "1px solid var(--border)",
                background: "var(--surface-2)",
                fontFamily: "var(--font-mono)",
                fontSize: "0.82rem",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {d.body}
            </pre>
          </details>
        ))}
        {deliveries.length === 0 && (
          <div className="card card-pad muted">Nothing sent yet — dispatch a task and its email lands here.</div>
        )}
      </div>
    </div>
  );
}
