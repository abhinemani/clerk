import Link from "next/link";
import { notFound } from "next/navigation";
import { DEMO_RELEASES } from "@/lib/demo";
import { getAgencyForSlug } from "@/lib/live";
import { SparkIcon } from "../../_components/ui";

export default async function ArchivePage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency) notFound();

  return (
    <div className="wrap" style={{ paddingBlock: "40px" }}>
      <Link href={`/${agency.slug}`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Back to portal
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 14 }}>
        {agency.name} · Public Records
      </span>
      <h1 style={{ fontSize: "2rem", marginTop: 8, marginBottom: 6, fontWeight: 600 }}>
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
