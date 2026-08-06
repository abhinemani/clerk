/**
 * Image decode/encode + pixel burning for VISUAL redaction (invariant 1).
 *
 * The visual studio burns rectangles into page images by setting the pixels
 * to black and RE-ENCODING — the covered content is destroyed in the raster,
 * not hidden under an overlay, so no PDF/image tool can lift the bar off.
 *
 * Codecs: JPEG via jpeg-js (pure JS, no native code — the self-contained
 * rule is about services and native deps, and this is neither); PNG via a
 * hand-rolled decoder on top of node:zlib (same spirit as the zip reader in
 * textExtract). Output is always JPEG — the burned artifact re-encodes the
 * ENTIRE page, so even unburned regions are new bytes.
 */
import { inflateSync } from "node:zlib";
import jpeg from "jpeg-js";

export interface RasterImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes/pixel, row-major. */
  data: Uint8Array;
}

/** Normalized rectangle (0..1 of page width/height; y measured from the top). */
export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Decompression guards — a page image, not a planetary photo mosaic. */
const MAX_PIXELS = 50_000_000; // ~50 MP
const JPEG_DECODE_OPTS = { useTArray: true, maxMemoryUsageInMB: 512, maxResolutionInMP: 50 } as const;

function isJpeg(bytes: Buffer): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}
function isPng(bytes: Buffer): boolean {
  return bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a;
}

/** Decode JPEG or PNG bytes to RGBA. Returns null for anything else/corrupt. */
export function decodeImage(bytes: Buffer): RasterImage | null {
  try {
    if (isJpeg(bytes)) {
      const out = jpeg.decode(bytes, JPEG_DECODE_OPTS);
      if (out.width * out.height > MAX_PIXELS) return null;
      return { width: out.width, height: out.height, data: new Uint8Array(out.data) };
    }
    if (isPng(bytes)) return decodePng(bytes);
  } catch {
    // Corrupt/hostile bytes — the caller treats "can't decode" as "can't redact".
  }
  return null;
}

/** Encode RGBA to JPEG. Quality 85 keeps stamps/signatures legible. */
export function encodeJpeg(image: RasterImage, quality = 85): Buffer {
  const { data } = jpeg.encode(
    { data: Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), width: image.width, height: image.height },
    quality,
  );
  return Buffer.from(data);
}

/**
 * Burn rectangles: set every covered pixel to opaque black, in place.
 * Rects are normalized so the same act applies at any render resolution.
 */
export function burnRegions(image: RasterImage, rects: NormalizedRect[]): void {
  for (const r of rects) {
    const x0 = clamp(Math.floor(r.x * image.width), 0, image.width);
    const y0 = clamp(Math.floor(r.y * image.height), 0, image.height);
    const x1 = clamp(Math.ceil((r.x + r.w) * image.width), 0, image.width);
    const y1 = clamp(Math.ceil((r.y + r.h) * image.height), 0, image.height);
    for (let y = y0; y < y1; y++) {
      let i = (y * image.width + x0) * 4;
      for (let x = x0; x < x1; x++) {
        image.data[i] = 0;
        image.data[i + 1] = 0;
        image.data[i + 2] = 0;
        image.data[i + 3] = 255;
        i += 4;
      }
    }
  }
}

/**
 * Burn verification (the visual analog of findLeaks): decode the ENCODED
 * bytes and confirm each rect's interior is black. JPEG ringing can bleed a
 * few levels at the edges, so we inset by 2px and allow luminance ≤ 32.
 * Returns the indexes of rects that are NOT verifiably black.
 */
export function findUnburnedRegions(encoded: Buffer, rects: NormalizedRect[]): number[] {
  const image = decodeImage(encoded);
  if (!image) return rects.map((_, i) => i); // undecodable artifact = fail all
  const bad: number[] = [];
  rects.forEach((r, idx) => {
    const x0 = clamp(Math.floor(r.x * image.width) + 2, 0, image.width);
    const y0 = clamp(Math.floor(r.y * image.height) + 2, 0, image.height);
    const x1 = clamp(Math.ceil((r.x + r.w) * image.width) - 2, 0, image.width);
    const y1 = clamp(Math.ceil((r.y + r.h) * image.height) - 2, 0, image.height);
    if (x1 <= x0 || y1 <= y0) return; // sub-4px sliver — nothing to verify
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * image.width + x) * 4;
        const lum = 0.299 * image.data[i]! + 0.587 * image.data[i + 1]! + 0.114 * image.data[i + 2]!;
        if (lum > 32) {
          bad.push(idx);
          return;
        }
      }
    }
  });
  return bad;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

// --- PNG (hand-rolled: IHDR/PLTE/IDAT over zlib, filters 0-4) --------------

function decodePng(bytes: Buffer): RasterImage | null {
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  const idat: Buffer[] = [];

  while (off + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(off);
    const type = bytes.subarray(off + 4, off + 8).toString("latin1");
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len; // length + type + data + crc
  }

  // The common web/scanner cases: 8-bit, non-interlaced. Anything fancier
  // (16-bit, Adam7) reads as "can't decode" and the caller says so honestly.
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) return null;
  if (bitDepth !== 8 || interlace !== 0 || idat.length === 0) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) return null;
  if (colorType === 3 && !palette) return null;

  const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: (width * channels + 1) * height });
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;

  // Un-filter row by row (spec filters: None/Sub/Up/Average/Paeth).
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const rowIn = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const rowOut = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? rowOut[i - channels]! : 0;
      const b = prev ? prev[i]! : 0;
      const c = prev && i >= channels ? prev[i - channels]! : 0;
      let v = rowIn[i]!;
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xff;
      else if (filter !== 0) return null;
      rowOut[i] = v;
    }
  }

  // Expand to RGBA.
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const s = p * channels;
    const d = p * 4;
    if (colorType === 0) {
      data[d] = data[d + 1] = data[d + 2] = px[s]!;
      data[d + 3] = 255;
    } else if (colorType === 2) {
      data[d] = px[s]!;
      data[d + 1] = px[s + 1]!;
      data[d + 2] = px[s + 2]!;
      data[d + 3] = 255;
    } else if (colorType === 3) {
      const pi = px[s]! * 3;
      data[d] = palette![pi] ?? 0;
      data[d + 1] = palette![pi + 1] ?? 0;
      data[d + 2] = palette![pi + 2] ?? 0;
      data[d + 3] = 255;
    } else if (colorType === 4) {
      data[d] = data[d + 1] = data[d + 2] = px[s]!;
      data[d + 3] = px[s + 1]!;
    } else {
      data[d] = px[s]!;
      data[d + 1] = px[s + 1]!;
      data[d + 2] = px[s + 2]!;
      data[d + 3] = px[s + 3]!;
    }
  }
  return { width, height, data };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
