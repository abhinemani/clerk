/** OCR adapter tests — engine selection, honest degradation, both engines. */
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisabledOcr, HttpOcr, TesseractCliOcr, getOcrEngine, isOcrImageMime } from "./ocr";

const env = (vars: Record<string, string> = {}) => vars as unknown as NodeJS.ProcessEnv;

describe("getOcrEngine", () => {
  it("is disabled by default — the self-contained deploy has no OCR", () => {
    expect(getOcrEngine(env()).kind).toBe("disabled");
  });

  it("selects the CLI engine when TESSERACT_PATH is set", () => {
    expect(getOcrEngine(env({ TESSERACT_PATH: "/usr/bin/tesseract" })).kind).toBe("tesseract-cli");
  });

  it("selects the HTTP engine when OCR_ENDPOINT is set", () => {
    expect(getOcrEngine(env({ OCR_ENDPOINT: "http://ocr:8884/tesseract" })).kind).toBe("http");
  });
});

describe("isOcrImageMime", () => {
  it("accepts scanner/photo formats and rejects the rest", () => {
    for (const yes of ["image/png", "image/jpeg", "image/jpg", "image/tiff", "image/webp"]) {
      expect(isOcrImageMime(yes)).toBe(true);
    }
    for (const no of ["application/pdf", "image/svg+xml", "text/plain", null, undefined, ""]) {
      expect(isOcrImageMime(no)).toBe(false);
    }
  });
});

describe("DisabledOcr", () => {
  it("recognizes nothing, honestly", async () => {
    expect(await new DisabledOcr().recognize()).toBeNull();
  });
});

describe("TesseractCliOcr", () => {
  it("returns stdout from a working binary and null from a missing one", async () => {
    // Stand-in binary with tesseract's contract: reads stdin, prints text.
    const dir = await mkdtemp(join(tmpdir(), "brandeis-ocr-"));
    try {
      const bin = join(dir, "fake-tesseract");
      await writeFile(bin, '#!/bin/sh\ncat > /dev/null\necho "RECOVERED FROM SCAN"\n');
      await chmod(bin, 0o755);
      const engine = new TesseractCliOcr(bin);
      expect(await engine.recognize(Buffer.from("fake-image"))).toBe("RECOVERED FROM SCAN");

      const missing = new TesseractCliOcr(join(dir, "does-not-exist"));
      expect(await missing.recognize(Buffer.from("fake-image"))).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats a non-zero exit as no text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "brandeis-ocr-"));
    try {
      const bin = join(dir, "failing-tesseract");
      await writeFile(bin, "#!/bin/sh\ncat > /dev/null\nexit 1\n");
      await chmod(bin, 0o755);
      expect(await new TesseractCliOcr(bin).recognize(Buffer.from("x"))).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("HttpOcr", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses the tesseract-server response shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: { stdout: "  sidecar text\n" } }))),
    );
    const text = await new HttpOcr("http://ocr:8884/tesseract").recognize(Buffer.from("img"), "image/png");
    expect(text).toBe("sidecar text");
  });

  it("falls back to a plain-text body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("plain wrapper text")));
    const text = await new HttpOcr("http://ocr/").recognize(Buffer.from("img"), "image/png");
    expect(text).toBe("plain wrapper text");
  });

  it("returns null on HTTP errors and network failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await new HttpOcr("http://ocr/").recognize(Buffer.from("img"), "image/png")).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))));
    expect(await new HttpOcr("http://ocr/").recognize(Buffer.from("img"), "image/png")).toBeNull();
  });

  it("returns null when the engine sees no text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: { stdout: "   " } }))),
    );
    expect(await new HttpOcr("http://ocr/").recognize(Buffer.from("img"), "image/png")).toBeNull();
  });
});
