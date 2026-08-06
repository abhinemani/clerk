import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  burnRegions,
  decodeImage,
  encodeJpeg,
  findUnburnedRegions,
  type RasterImage,
} from "./imageCodec";

/** A solid-color RGBA raster. */
function solid(width: number, height: number, [r, g, b]: [number, number, number]): RasterImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/** Minimal valid 8-bit RGB PNG (filter 0 rows), CRCs faked — we don't check them. */
function buildPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, data, Buffer.alloc(4)]); // zero CRC — decoder ignores it
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("decodeImage", () => {
  it("round-trips a JPEG (encode → decode)", () => {
    const jpeg = encodeJpeg(solid(40, 30, [200, 40, 40]));
    const back = decodeImage(jpeg);
    expect(back).not.toBeNull();
    expect(back!.width).toBe(40);
    expect(back!.height).toBe(30);
    // JPEG is lossy — the middle pixel should still be recognizably red.
    const i = (15 * 40 + 20) * 4;
    expect(back!.data[i]).toBeGreaterThan(150);
    expect(back!.data[i + 1]).toBeLessThan(90);
  });

  it("decodes a hand-built RGB PNG", () => {
    const png = buildPng(20, 10, [10, 200, 30]);
    const img = decodeImage(png);
    expect(img).not.toBeNull();
    expect(img!.width).toBe(20);
    const i = (5 * 20 + 10) * 4;
    expect([img!.data[i], img!.data[i + 1], img!.data[i + 2]]).toEqual([10, 200, 30]);
  });

  it("returns null for junk bytes instead of throwing", () => {
    expect(decodeImage(Buffer.from("not an image at all"))).toBeNull();
    expect(decodeImage(Buffer.alloc(0))).toBeNull();
  });
});

describe("burnRegions + findUnburnedRegions — the visual leak check", () => {
  it("burned pixels are destroyed in the RE-ENCODED bytes, not overlaid", () => {
    const img = solid(100, 100, [255, 255, 255]);
    burnRegions(img, [{ x: 0.2, y: 0.2, w: 0.4, h: 0.3 }]);
    const encoded = encodeJpeg(img);
    const back = decodeImage(encoded)!;
    // Center of the burn: black. Outside: still white.
    const inside = ((35 * 100) + 40) * 4;
    const outside = ((80 * 100) + 80) * 4;
    expect(back.data[inside]).toBeLessThanOrEqual(32);
    expect(back.data[outside]).toBeGreaterThan(200);
    // And the verifier agrees.
    expect(findUnburnedRegions(encoded, [{ x: 0.2, y: 0.2, w: 0.4, h: 0.3 }])).toEqual([]);
  });

  it("flags a region that was NOT actually burned", () => {
    const encoded = encodeJpeg(solid(100, 100, [255, 255, 255])); // nothing burned
    expect(findUnburnedRegions(encoded, [{ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }])).toEqual([0]);
  });

  it("out-of-range rects clamp instead of corrupting neighboring pixels", () => {
    const img = solid(10, 10, [255, 255, 255]);
    burnRegions(img, [{ x: 0.8, y: 0.8, w: 0.9, h: 0.9 }]); // spills past the edge
    expect(img.data[0]).toBe(255); // top-left untouched
    const corner = (9 * 10 + 9) * 4;
    expect(img.data[corner]).toBe(0); // bottom-right burned
  });
});
