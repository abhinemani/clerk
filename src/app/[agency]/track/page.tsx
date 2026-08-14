import Link from "next/link";
import { notFound } from "next/navigation";
import { getAgencyForSlug } from "@/lib/live";
import { RequestTracker } from "../../_components/RequestTracker";
import { TrackingReminderForm } from "../../_components/TrackingReminderForm";

export default async function TrackPage({
  params,
  searchParams,
}: {
  params: Promise<{ agency: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const [{ agency: slug }, { id }] = await Promise.all([params, searchParams]);
  const agency = await getAgencyForSlug(slug);
  if (!agency) notFound();

  return (
    <>
      <div className="civic-hero">
        <div className="wrap" style={{ maxWidth: 680, paddingBlock: "36px 30px" }}>
          <Link href={`/${agency.slug}`} className="muted" style={{ fontSize: "0.9rem" }}>
            ← Back to portal
          </Link>
          <span className="eyebrow" style={{ display: "block", marginTop: 14 }}>
            {agency.name} · Public Records
          </span>
          <h1 style={{ fontSize: "2rem", marginTop: 8, marginBottom: 6, fontWeight: 600 }}>
            Track your request
          </h1>
          <p className="muted" style={{ marginBottom: 20, fontSize: "0.98rem" }}>
            Your tracking number was shown when you filed and emailed to you if you gave an
            address. Every request shows its status, statutory deadline, and released records.
          </p>
          <RequestTracker agencySlug={agency.slug} initialId={id ?? ""} />
        </div>
      </div>

      <div className="wrap" style={{ maxWidth: 680, paddingBlock: "26px 40px" }}>
        <div className="card card-pad">
          <div className="panel-title">Lost your tracking number?</div>
          <p className="muted" style={{ fontSize: "0.9rem", margin: "8px 0 12px" }}>
            We&apos;ll email the tracking numbers of requests filed with your address — they only
            ever go to that address.
          </p>
          <TrackingReminderForm agencySlug={agency.slug} />
        </div>
        <p className="muted" style={{ fontSize: "0.88rem", marginTop: 16 }}>
          Have an account?{" "}
          <Link href={`/${agency.slug}/login`} style={{ fontWeight: 600 }}>
            Sign in
          </Link>{" "}
          to see all your requests in one place — or{" "}
          <Link href={`/${agency.slug}/request`} style={{ fontWeight: 600 }}>
            file a new request
          </Link>
          .
        </p>
      </div>
    </>
  );
}
