/**
 * Image-rendition PDF (visual redaction finalize; invariant 1).
 *
 * Assembles a PDF whose pages are exactly the burned JPEG rasters — one
 * full-page image per page, nothing else. Like renderTextPdf, the artifact
 * is REGENERATED: it never contained the un-burned pixels, so there is
 * nothing to recover. No text layer exists at all.
 *
 * Pure function; binary-safe (JPEG streams are embedded as raw bytes, the
 * structural text around them as latin1). Companion to
 * `extractPdfImages` in textExtract.ts, which can re-extract these very
 * DCTDecode streams — the round-trip is how tests verify the burn.
 */

export interface PdfPageImage {
  /** Burned JPEG bytes for this page. */
  jpeg: Buffer;
  width: number;
  height: number;
}

function esc(s: string): string {
  return s.replace(/[\\()]/g, (c) => `\\${c}`);
}

/** Assemble page images into a PDF. Page size = image size in points (72dpi). */
export function imagesToPdf(pages: PdfPageImage[], title = "Released record"): Buffer {
  if (pages.length === 0) throw new Error("imagesToPdf: at least one page required");

  // Object layout: 1 Catalog · 2 Pages · then per page: Page, Contents, Image.
  const objCount = 2 + pages.length * 3;
  const pageObjId = (i: number) => 3 + i * 3;

  const chunks: Buffer[] = [];
  const offsets: number[] = new Array(objCount + 1).fill(0);
  let position = 0;
  const push = (piece: Buffer | string) => {
    const buf = typeof piece === "string" ? Buffer.from(piece, "latin1") : piece;
    chunks.push(buf);
    position += buf.length;
  };
  const beginObj = (id: number) => {
    offsets[id] = position;
    push(`${id} 0 obj\n`);
  };

  push(`%PDF-1.4\n%\xE2\xE3\xCF\xD3\n`);

  beginObj(1);
  push(`<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  beginObj(2);
  push(
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObjId(i)} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`,
  );

  pages.forEach((page, i) => {
    const pid = pageObjId(i);
    const contentId = pid + 1;
    const imageId = pid + 2;

    beginObj(pid);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    );

    const content = `q ${page.width} 0 0 ${page.height} 0 0 cm /Im0 Do Q`;
    beginObj(contentId);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

    beginObj(imageId);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    push(page.jpeg);
    push(`\nendstream\nendobj\n`);
  });

  const xrefAt = position;
  push(`xref\n0 ${objCount + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= objCount; id++) {
    push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${objCount + 1} /Root 1 0 R /Info << /Title (${esc(title)}) >> >>\n` +
      `startxref\n${xrefAt}\n%%EOF\n`,
  );

  return Buffer.concat(chunks);
}
