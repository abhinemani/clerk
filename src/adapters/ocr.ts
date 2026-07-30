/**
 * OCR behind an interface (spec §6.5) — the recovery path for documents whose
 * bytes carry no text layer: scans, photos, image-only PDFs.
 *
 * Self-contained first: OCR is OFF by default and the platform degrades
 * honestly — a document with no extractable text can only be withheld or
 * released whole, and the review UI says so. Enabling it is one env var,
 * no accounts:
 *
 *  - TESSERACT_PATH — path (or bare command name) of a local tesseract
 *    binary; spoken to over stdin/stdout, no temp files. `brew install
 *    tesseract` / `apt install tesseract-ocr` and you're done.
 *  - OCR_ENDPOINT — URL of a tesseract HTTP sidecar (e.g. the
 *    hertzg/tesseract-server container's /tesseract endpoint), for the
 *    Docker deploy. Multipart POST via fetch, no SDK.
 *  - OCR_LANGS — optional language list for either engine (default "eng").
 *
 * Fail-soft, unlike the virus scanner: OCR failure means a document stays
 * text-less (a capability gap, surfaced in the UI), never a refused upload.
 */
import { spawn } from "node:child_process";

export interface OcrEngine {
  readonly kind: "disabled" | "tesseract-cli" | "http";
  /** Recognized text for one image, or null when no text can be produced. */
  recognize(image: Buffer, mimeType: string): Promise<string | null>;
}

/** Mime types the engines accept directly (whole-file OCR candidates). */
const OCR_IMAGE_MIME = /^image\/(png|jpe?g|tiff?|bmp|webp|gif)$/i;

export function isOcrImageMime(mime: string | null | undefined): boolean {
  return !!mime && OCR_IMAGE_MIME.test(mime);
}

/** The honest default: no engine, no text, no pretending. */
export class DisabledOcr implements OcrEngine {
  readonly kind = "disabled" as const;
  async recognize(): Promise<null> {
    return null;
  }
}

/** Local tesseract binary over stdin/stdout — no temp files, no service. */
export class TesseractCliOcr implements OcrEngine {
  readonly kind = "tesseract-cli" as const;

  constructor(
    private readonly command: string,
    private readonly langs = "eng",
    private readonly timeoutMs = 60_000,
  ) {}

  recognize(image: Buffer): Promise<string | null> {
    return new Promise((resolve) => {
      const child = spawn(this.command, ["stdin", "stdout", "-l", this.langs], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(null);
      }, this.timeoutMs);

      const out: Buffer[] = [];
      let err = "";
      child.stdout.on("data", (c: Buffer) => out.push(c));
      child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
      child.on("error", () => {
        clearTimeout(timer);
        resolve(null); // binary missing/unrunnable — degrade, don't throw
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          console.warn(`[ocr] tesseract exited ${code}: ${err.slice(0, 300)}`);
          return resolve(null);
        }
        const text = Buffer.concat(out).toString("utf8").trim();
        resolve(text.length > 0 ? text : null);
      });
      child.stdin.on("error", () => {}); // EPIPE if tesseract dies early
      child.stdin.end(image);
    });
  }
}

/**
 * Tesseract HTTP sidecar (fetch-only). Speaks the tesseract-server multipart
 * contract ({options, file} → {data:{stdout}}) and falls back to treating the
 * response body as plain text for simpler wrappers.
 */
export class HttpOcr implements OcrEngine {
  readonly kind = "http" as const;

  constructor(
    private readonly endpoint: string,
    private readonly langs = "eng",
    private readonly timeoutMs = 60_000,
  ) {}

  async recognize(image: Buffer, mimeType: string): Promise<string | null> {
    try {
      const form = new FormData();
      form.set("options", JSON.stringify({ languages: this.langs.split("+") }));
      form.set("file", new Blob([new Uint8Array(image)], { type: mimeType }), "page");
      const res = await fetch(this.endpoint, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        console.warn(`[ocr] endpoint returned ${res.status}`);
        return null;
      }
      const body = await res.text();
      let text = body;
      try {
        const json = JSON.parse(body) as { data?: { stdout?: string }; text?: string };
        text = json.data?.stdout ?? json.text ?? "";
      } catch {
        // Plain-text wrapper — the body IS the recognized text.
      }
      const trimmed = text.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch (err) {
      console.warn(`[ocr] endpoint call failed`, err);
      return null;
    }
  }
}

/** Env-configured engine; disabled (honest no-text) when nothing is set. */
export function getOcrEngine(env: NodeJS.ProcessEnv = process.env): OcrEngine {
  const langs = env.OCR_LANGS || "eng";
  if (env.TESSERACT_PATH) return new TesseractCliOcr(env.TESSERACT_PATH, langs);
  if (env.OCR_ENDPOINT) return new HttpOcr(env.OCR_ENDPOINT, langs);
  return new DisabledOcr();
}
