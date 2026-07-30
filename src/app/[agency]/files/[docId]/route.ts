/**
 * Blob download endpoint — one gate for every file the system serves, with
 * the release decision as the source of truth (spec §10: what a requester
 * can see is decided by a named human, enforced here):
 *
 *   1. classification='public' documents        → anyone
 *   2. artifacts of a PUBLIC release            → anyone (the archive)
 *   3. artifacts of a private release           → the owning requester
 *   4. anything in the agency                   → that agency's staff
 *
 * Withheld documents never match 1–3; only staff (4) can retrieve them.
 */
import { auth } from "@/auth";
import { getBlobStore } from "@/adapters/blobStore";
import { getRepository } from "@/db/createRepository";

export const runtime = "nodejs";

const notFound = () => Response.json({ error: "not_found" }, { status: 404 });
const forbidden = () => Response.json({ error: "forbidden" }, { status: 403 });

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ agency: string; docId: string }> },
) {
  const { agency: slug, docId } = await params;
  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  if (!agency) return notFound();

  const doc = await repo.getDocument(agency.id, docId);
  if (!doc || !doc.blobRef) return notFound();

  let allowed = doc.classification === "public"; // rule 1

  let release = null;
  if (!allowed) {
    release = await repo.findReleaseContainingDocument(agency.id, doc.id);
    if (release?.visibility === "public") allowed = true; // rule 2
  }

  if (!allowed) {
    const session = await auth();
    const u = session?.user;
    if (u?.kind === "staff" && u.agencyId === agency.id) {
      allowed = true; // rule 4
    } else if (u?.kind === "requester" && u.agencyId === agency.id && release) {
      const request = await repo.getRequest(agency.id, release.requestId);
      allowed = request?.requesterId === u.id; // rule 3
    }
  }
  if (!allowed) return forbidden();

  const blob = await getBlobStore().get(doc.blobRef);
  if (!blob) return notFound();

  return new Response(new Uint8Array(blob.bytes), {
    headers: {
      "content-type": doc.mimeType ?? blob.contentType,
      "content-length": String(blob.bytes.length),
      "content-disposition": `attachment; filename="${(doc.filename ?? "record").replace(/[^\w.\- ]/g, "_")}"`,
      "cache-control": "private, max-age=0",
      ...(doc.checksum ? { "x-checksum-sha256": doc.checksum } : {}),
    },
  });
}
