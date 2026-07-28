import Link from "next/link";
import { DEMO_AGENCY, DEMO_RELEASES } from "@/lib/demo";
import { SparkIcon } from "../../_components/ui";

export default function ArchivePage() {
  return (
    <div className="wrap" style={{ paddingBlock: "40px" }}>
      <Link href="/" className="muted" style={{ fontSize: "0.9rem" }}>
        ← Back to portal
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 14 }}>
        {DEMO_AGENCY.name} · Public Records
      </span>
      <h1 className="serif" style={{ fontSize: "2rem", marginTop: 8, marginBottom: 6, fontWeight: 600 }}>
        Public records archive
      </h1>
      <p className="muted" style={{ fontSize: "1.02rem", marginBottom: 24 }}>
        Records already released to the public. Every entry is free to download — no request needed.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 16,
        }}
      >
        {DEMO_RELEASES.map((r) => (
          <article key={r.id} className="card card-pad hover-lift">
            <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--ai)" }}>
              <SparkIcon />
              <span style={{ fontSize: "0.76rem", fontWeight: 600 }}>AI-summarized</span>
            </div>
            <h2 style={{ fontSize: "1.08rem", marginTop: 8 }}>{r.title}</h2>
            <p className="muted" style={{ fontSize: "0.9rem", marginTop: 6 }}>
              {r.summary}
            </p>
            <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
              <span className="tag">Released {r.date}</span>
              {r.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
              <button className="btn btn-sm btn-primary" style={{ marginLeft: "auto" }}>
                Download
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
