import Link from "next/link";
import { notFound } from "next/navigation";
import { listArchive } from "@/lib/archive";
import { getAgencyForSlug } from "@/lib/live";
import { PortalTabs } from "../_components/PortalTabs";
import { Seal, SparkIcon } from "../_components/ui";

export const dynamic = "force-dynamic";

export default async function Portal({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency) notFound();
  const releases = (await listArchive(slug)).slice(0, 3);

  return (
    <>
    {/* Hero — official letterhead: seal, office line, double rule, full-bleed
        wash. The question box stays the front door, not a form (§6.7). */}
    <section className="portal-hero">
      <div className="wrap" style={{ maxWidth: 768, paddingBlock: "56px 40px", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <Seal size={68} label={`Seal of the ${agency.name}`} />
        </div>
        <span className="smallcaps" style={{ fontSize: "0.95rem", color: "var(--maroon)" }}>
          {agency.name} · Office of the City Clerk
        </span>
        <h1 style={{ fontSize: "clamp(2.1rem, 5vw, 3.1rem)", marginTop: 10, fontWeight: 600 }}>
          What public records are you looking for?
        </h1>
        <hr className="letterhead-rule" aria-hidden />
        <p className="muted" style={{ fontSize: "1.1rem", marginTop: 18, marginBottom: 24 }}>
          Ask in plain language. Many records are already public — you can often get what you need in
          seconds, without filing a request.
        </p>
        <PortalTabs agencySlug={agency.slug} />
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            justifyContent: "center",
            marginTop: 18,
          }}
        >
          {["Free", "No account needed", "Plain-language answers", "Typical response: 10 days"].map(
            (chip) => (
              <span key={chip} className="tag">
                {chip}
              </span>
            ),
          )}
        </div>
      </div>
    </section>

    <div className="wrap" style={{ paddingBlock: "8px" }}>
      {/* How it works */}
      <section style={{ marginTop: 48 }}>
        <div className="stat-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          {[
            {
              t: "Answer",
              d: "We check already-public records first and hand you the document if we have it.",
            },
            {
              t: "Narrow",
              d: "If part is public, we help you request only what's missing — a tighter, faster request.",
            },
            {
              t: "File",
              d: "Filing is always one click away. Track status and message the office anytime.",
            },
          ].map((s, i) => (
            <div key={s.t} className="stat" style={{ padding: "22px 24px" }}>
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: "1.05rem",
                  color: "var(--primary)",
                  fontWeight: 600,
                }}
              >
                {i + 1}. {s.t}
              </div>
              <div className="muted" style={{ fontSize: "0.92rem", marginTop: 6 }}>
                {s.d}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Public archive */}
      <section style={{ marginTop: 56 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "1.35rem" }}>Recently released records</h2>
          <Link href={`/${agency.slug}/archive`} style={{ fontWeight: 500, fontSize: "0.92rem" }}>
            Browse the full archive →
          </Link>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
            marginTop: 18,
          }}
        >
          {releases.map((r) => (
            <article key={r.id} className="card card-pad hover-lift">
              <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--ai)" }}>
                <SparkIcon />
                <span style={{ fontSize: "0.76rem", fontWeight: 600 }}>AI-summarized</span>
              </div>
              <h3 style={{ fontSize: "1.05rem", marginTop: 8 }}>{r.title}</h3>
              <p className="muted" style={{ fontSize: "0.9rem", marginTop: 6 }}>
                {r.summary}
              </p>
              <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                {r.tags.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
    </>
  );
}
