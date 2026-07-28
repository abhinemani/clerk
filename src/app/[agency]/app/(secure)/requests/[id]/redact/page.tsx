import Link from "next/link";
import { notFound } from "next/navigation";
import { getRequestDetail } from "@/lib/live";
import { EXEMPTION_OPTIONS, REDACTION_DEMO } from "@/lib/redactionDemo";
import { RedactionStudio } from "../../../../../../_components/RedactionStudio";

export default async function RedactPage({
  params,
}: {
  params: Promise<{ agency: string; id: string }>;
}) {
  const { agency: slug, id } = await params;
  const detail = await getRequestDetail(slug, id);
  if (!detail) notFound();
  const request = detail.request;

  return (
    <div className="wrap" style={{ paddingBlock: "28px 8px" }}>
      <Link href={`/${slug}/app/requests/${id}`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← {request.publicId}
      </Link>
      <h1 style={{ fontSize: "1.6rem", marginTop: 8, marginBottom: 4, fontWeight: 600 }}>
        Redaction studio
      </h1>
      <p className="muted" style={{ fontSize: "0.95rem", marginBottom: 20 }}>
        Black out lines or areas before release. Every redaction needs an exemption reason; the AI
        pre-flags likely PII but never redacts on its own.
      </p>

      <RedactionStudio
        documentName={REDACTION_DEMO.documentName}
        requestPublicId={request.publicId}
        lines={[...REDACTION_DEMO.lines]}
        exemptions={[...EXEMPTION_OPTIONS]}
      />
    </div>
  );
}
