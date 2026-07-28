import Link from "next/link";
import { DEMO_AGENCY } from "@/lib/demo";
import { RequestTracker } from "../../_components/RequestTracker";

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;

  return (
    <div className="wrap" style={{ maxWidth: 680, paddingBlock: "40px" }}>
      <Link href="/" className="muted" style={{ fontSize: "0.9rem" }}>
        ← Back to portal
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 14 }}>
        {DEMO_AGENCY.name} · Public Records
      </span>
      <h1 className="serif" style={{ fontSize: "2rem", marginTop: 8, marginBottom: 20, fontWeight: 600 }}>
        Track your request
      </h1>
      <RequestTracker initialId={id ?? ""} />
    </div>
  );
}
