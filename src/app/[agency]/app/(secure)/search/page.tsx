import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import { dateShort, titleCase } from "@/lib/format";
import { searchAgencyRecords, type RecordsSearchHit } from "@/services/recordsSearchService";
import { AttachButton } from "../../../../_components/AttachButton";

export const dynamic = "force-dynamic";

/**
 * Staff responsive-records search (§6.4): find records across the FULL
 * corpus — public and internal — and attach them to a request's review set.
 * Staff-only surface; the requester-facing archive search stays public-only.
 */
export default async function RecordsSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ agency: string }>;
  searchParams: Promise<{ q?: string; req?: string }>;
}) {
  const [{ agency: slug }, { q = "", req }] = await Promise.all([params, searchParams]);
  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) notFound();
  const staff = await requireStaff(slug);

  const repo = await getRepository();
  const query = q.trim();

  let target: { id: string; publicId: string; scope: string } | null = null;
  if (req) {
    const request = await repo.getRequest(staff.agencyId, req);
    if (request) {
      target = {
        id: request.id,
        publicId: request.publicId,
        scope: request.interpretedScope ?? request.rawText,
      };
    }
  }

  let hits: RecordsSearchHit[] = [];
  if (query.length >= 2) {
    hits = await searchAgencyRecords(
      { repo },
      { agencyId: staff.agencyId, query, forRequestId: target?.id },
    );
  }

  return (
    <div className="wrap" style={{ paddingBlock: "var(--page-top-snug) 8px", maxWidth: 860 }}>
      <Link
        href={target ? `/${slug}/app/requests/${target.id}` : `/${slug}/app`}
        className="muted"
        style={{ fontSize: "0.9rem" }}
      >
        ← {target ? target.publicId : "Command center"}
      </Link>
      <h1 style={{ fontSize: "1.6rem", marginTop: 8, marginBottom: 4, fontWeight: 600 }}>
        Records search
      </h1>
      <p className="muted" style={{ fontSize: "0.95rem", marginBottom: 16, maxWidth: 620 }}>
        Searches everything in {agency.name}&apos;s corpus — filenames, extracted text, and
        metadata, internal records included. This surface is staff-only; residents see only the
        public archive.
      </p>

      {target && (
        <div className="card card-pad" style={{ marginBottom: 16, borderLeft: "3px solid var(--accent)" }}>
          <div className="panel-title">Finding records for {target.publicId}</div>
          <p className="muted" style={{ fontSize: "0.9rem", margin: "6px 0 0" }}>
            “{target.scope.slice(0, 240)}” — attach results directly to this request&apos;s review
            set.
          </p>
        </div>
      )}

      <form method="GET" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {target && <input type="hidden" name="req" value={target.id} />}
        <input
          className="field"
          style={{ flex: 1, minWidth: 220 }}
          type="search"
          name="q"
          defaultValue={query}
          placeholder="e.g. Maple Avenue sidewalk, invoice BP-2261, incident 2026…"
          aria-label="Search agency records"
          autoComplete="off"
        />
        <button className="btn btn-primary" type="submit">
          Search
        </button>
      </form>

      {query.length < 2 && (
        <div className="card card-pad" style={{ marginTop: 16 }}>
          <div className="panel-title">What this finds</div>
          <ul className="muted" style={{ fontSize: "0.9rem", margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
            <li>Street names, vendors, case numbers, people — anywhere in a record&apos;s text.</li>
            <li>Filenames and metadata (record type, tags, dates) — even for records without extracted text.</li>
            <li>
              Working a request? Open it and press <strong>Find records</strong> — results can then
              be attached straight to its review set.
            </li>
          </ul>
        </div>
      )}

      {query.length >= 2 && (
        <div style={{ marginTop: 16 }}>
          <div className="muted" style={{ fontSize: "0.85rem", marginBottom: 10 }}>
            {hits.length === 0
              ? "No records match. Extraction-less documents (unscanned images) can't be found by text — check the request's task uploads directly."
              : `${hits.length} record${hits.length === 1 ? "" : "s"} matched.`}
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
            {hits.map((h) => (
              <li key={h.documentId} className="card" style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600 }}>{h.filename}</span>
                  <span className={`pill ${h.classification === "public" ? "band-on_track" : ""}`}>
                    {h.classification}
                  </span>
                  <span className="tag">{titleCase(h.provenance.replace(/_/g, " "))}</span>
                  {h.recordType && <span className="tag">{h.recordType}</span>}
                  <span className="muted" style={{ fontSize: "0.8rem", marginLeft: "auto" }}>
                    {dateShort(h.createdAt)}
                  </span>
                </div>
                <p className="muted" style={{ fontSize: "0.9rem", margin: "8px 0 0" }}>{h.snippet}</p>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                  <span className="muted" style={{ fontSize: "0.78rem" }}>{h.whyMatched}</span>
                  <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
                    {target && (
                      <AttachButton
                        agencySlug={slug}
                        requestId={target.id}
                        documentId={h.documentId}
                        attached={h.alreadyAttached ?? false}
                      />
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
