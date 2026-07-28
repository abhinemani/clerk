import Link from "next/link";
import { DEMO_AGENCY, DEMO_RELEASES } from "@/lib/demo";
import { PortalTabs } from "./_components/PortalTabs";
import { SparkIcon } from "./_components/ui";

export default function Portal() {
  return (
    <div className="wrap" style={{ paddingBlock: "56px 8px" }}>
      {/* Hero — the question box is the front door, not a form (§6.7) */}
      <section style={{ maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
        <span className="eyebrow">{DEMO_AGENCY.name} · Public Records</span>
        <h1
          className="serif"
          style={{ fontSize: "clamp(2.1rem, 5vw, 3.2rem)", marginTop: 14, fontWeight: 600 }}
        >
          What public records are you looking for?
        </h1>
        <p className="muted" style={{ fontSize: "1.1rem", marginTop: 14, marginBottom: 24 }}>
          Ask in plain language. Many records are already public — you can often get what you need in
          seconds, without filing a request.
        </p>
        <PortalTabs />
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
      </section>

      {/* How it works */}
      <section style={{ marginTop: 72 }}>
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
          <Link href="/portal/archive" style={{ fontWeight: 500, fontSize: "0.92rem" }}>
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
          {DEMO_RELEASES.map((r) => (
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
  );
}
