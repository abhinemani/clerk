/**
 * Page-image feed for the visual redaction studio — staff-only, scoped to
 * documents in THIS request's review set. Serves the raw page raster the
 * studio draws boxes over; the burn itself happens server-side at finalize.
 */
import { getBlobStore } from "@/adapters/blobStore";
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { documentPageImages } from "@/services/visualRedactionService";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ agency: string; id: string; docId: string; n: string }> },
) {
  const { agency: slug, id, docId, n } = await params;
  const staff = await requireStaff(slug);

  const repo = await getRepository();
  const inReviewSet = (await repo.listRequestDocuments(staff.agencyId, id)).some((d) => d.id === docId);
  if (!inReviewSet) return new Response("not found", { status: 404 });
  const doc = await repo.getDocument(staff.agencyId, docId);
  if (!doc?.blobRef) return new Response("not found", { status: 404 });

  const blob = await getBlobStore().get(doc.blobRef);
  if (!blob) return new Response("not found", { status: 404 });
  const pages = documentPageImages(blob.bytes, doc.mimeType ?? blob.contentType ?? null);
  const index = Number.parseInt(n, 10);
  const page = Number.isInteger(index) ? pages[index] : undefined;
  if (!page) return new Response("not found", { status: 404 });

  const isPng = page.readUInt32BE(0) === 0x89504e47;
  return new Response(new Uint8Array(page), {
    headers: {
      "Content-Type": isPng ? "image/png" : "image/jpeg",
      // Review-set material: never cache beyond this staff session.
      "Cache-Control": "private, max-age=300",
    },
  });
}
