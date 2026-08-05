import { NextResponse } from "next/server";
import { getBlobStore } from "@/adapters/blobStore";
import { getRepository } from "@/db/createRepository";

/**
 * The tenant's uploaded seal (public — it appears on every portal page).
 * 404 when the agency hasn't uploaded one; the UI falls back to the generic
 * civic seal, so this route is only ever requested when a blob exists.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await ctx.params;
  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  const key = agency?.branding?.sealBlobRef;
  if (!key) return new NextResponse(null, { status: 404 });

  const blob = await getBlobStore().get(key);
  if (!blob) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(blob.bytes), {
    headers: {
      "Content-Type": blob.contentType || "image/png",
      // The key changes on every upload, so long cache is safe per URL…
      // except the URL is stable (/seal). Short cache + revalidate.
      "Cache-Control": "public, max-age=300, must-revalidate",
    },
  });
}
