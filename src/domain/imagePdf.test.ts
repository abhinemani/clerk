import { describe, expect, it } from "vitest";
import { extractPdfImages, extractText } from "@/adapters/textExtract";
import { burnRegions, decodeImage, encodeJpeg, findUnburnedRegions, type RasterImage } from "@/adapters/imageCodec";
import { imagesToPdf } from "./imagePdf";

function solid(width: number, height: number, rgb: [number, number, number]): RasterImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data.set([...rgb, 255], i * 4);
  }
  return { width, height, data };
}

describe("imagesToPdf", () => {
  it("produces a PDF whose embedded images round-trip through extractPdfImages", () => {
    const p1 = encodeJpeg(solid(60, 40, [255, 255, 255]));
    const p2 = encodeJpeg(solid(60, 40, [120, 120, 120]));
    const pdf = imagesToPdf(
      [
        { jpeg: p1, width: 60, height: 40 },
        { jpeg: p2, width: 60, height: 40 },
      ],
      "two pages",
    );

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const extracted = extractPdfImages(pdf);
    expect(extracted).toHaveLength(2);
    expect(Buffer.compare(extracted[0]!.bytes, p1)).toBe(0); // byte-identical embed
    expect(Buffer.compare(extracted[1]!.bytes, p2)).toBe(0);
  });

  it("has NO text layer — extraction finds nothing to read", () => {
    const pdf = imagesToPdf([{ jpeg: encodeJpeg(solid(30, 30, [0, 0, 0])), width: 30, height: 30 }]);
    const text = extractText(pdf, "application/pdf");
    expect(text === null || text.lines.join("").trim() === "").toBe(true);
  });

  it("END-TO-END invariant 1: a burned page re-extracted from the artifact is verifiably black", () => {
    // "Original": a white page (stand-in for a scanned report full of PII).
    const page = solid(200, 100, [255, 255, 255]);
    const rect = { x: 0.1, y: 0.2, w: 0.5, h: 0.4 };
    burnRegions(page, [rect]);
    const burnedJpeg = encodeJpeg(page);

    const artifact = imagesToPdf([{ jpeg: burnedJpeg, width: 200, height: 100 }], "released");

    // Adversary path: pull the image back OUT of the released PDF and look
    // under the bar. There is nothing under the bar.
    const recovered = extractPdfImages(artifact);
    expect(recovered).toHaveLength(1);
    expect(findUnburnedRegions(recovered[0]!.bytes, [rect])).toEqual([]);
    // And unburned regions survived (the release is still a usable record).
    const img = decodeImage(recovered[0]!.bytes)!;
    const outside = (10 * 200 + 190) * 4;
    expect(img.data[outside]).toBeGreaterThan(200);
  });
});
