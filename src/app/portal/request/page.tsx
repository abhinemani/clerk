import Link from "next/link";
import { DEMO_AGENCY } from "@/lib/demo";
import { RequestForm } from "../../_components/RequestForm";

export default async function RequestPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  return (
    <div className="wrap" style={{ maxWidth: 720, paddingBlock: "40px" }}>
      <Link href="/" className="muted" style={{ fontSize: "0.9rem" }}>
        ← Back to portal
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 14 }}>
        {DEMO_AGENCY.name} · Public Records
      </span>
      <h1 className="serif" style={{ fontSize: "2rem", marginTop: 8, marginBottom: 8, fontWeight: 600 }}>
        File a records request
      </h1>
      <p className="muted" style={{ fontSize: "1.02rem", marginBottom: 24 }}>
        Tell us what you&apos;re looking for in plain language. We&apos;ll route it to the right
        departments and keep you posted.
      </p>
      <RequestForm initialQuery={q ?? ""} />
    </div>
  );
}
