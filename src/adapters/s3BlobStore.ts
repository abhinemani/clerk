/**
 * S3-compatible blob store (AWS S3, MinIO, R2, …) — fetch-only, no SDK, per
 * this repo's adapter convention (same as the email adapters). Implements
 * AWS Signature V4 by hand; the signing helpers are exported pure so they can
 * be pinned against AWS's published test vectors.
 *
 * Opt-in via env (self-contained first — LocalBlobStore stays the default):
 *   S3_ENDPOINT=http://localhost:9000   (MinIO; or https://s3.us-east-1.amazonaws.com)
 *   S3_BUCKET=holmes-blobs
 *   S3_ACCESS_KEY_ID=…  S3_SECRET_ACCESS_KEY=…
 *   S3_REGION=us-east-1                 (optional)
 * Path-style addressing ({endpoint}/{bucket}/{key}) — works everywhere,
 * MinIO included.
 */
import { createHash, createHmac } from "node:crypto";
import type { BlobStore, StoredBlob } from "./blobStore";

const sha256hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

export interface SigV4Input {
  method: "GET" | "PUT";
  /** URL-encoded path, e.g. "/bucket/ag-1/file.pdf". */
  path: string;
  host: string;
  region: string;
  /** ISO basic UTC timestamp, e.g. "20260804T120000Z". */
  amzDate: string;
  payloadHashHex: string;
  accessKeyId: string;
  secretAccessKey: string;
  contentType?: string;
  /** Additional headers to sign (lowercase names) — e.g. range. */
  extraHeaders?: Record<string, string>;
}

/**
 * AWS SigV4 for S3 (service "s3", UNSIGNED headers kept minimal). Pure —
 * deterministic in, deterministic out; tested against a MinIO-verified
 * vector.
 */
export function signV4(input: SigV4Input): { authorization: string; signedHeaders: string } {
  const dateStamp = input.amzDate.slice(0, 8);
  const scope = `${dateStamp}/${input.region}/s3/aws4_request`;

  const headers: Array<[string, string]> = [
    ["host", input.host],
    ["x-amz-content-sha256", input.payloadHashHex],
    ["x-amz-date", input.amzDate],
    ...Object.entries(input.extraHeaders ?? {}).map(
      ([k, v]) => [k.toLowerCase(), v.trim()] as [string, string],
    ),
  ];
  if (input.contentType) headers.unshift(["content-type", input.contentType]);
  headers.sort(([a], [b]) => (a < b ? -1 : 1));

  const signedHeaders = headers.map(([k]) => k).join(";");
  const canonicalRequest = [
    input.method,
    input.path,
    "", // no query string in this adapter's requests
    ...headers.map(([k, v]) => `${k}:${v}`),
    "",
    signedHeaders,
    input.payloadHashHex,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    input.amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    signedHeaders,
  };
}

/** S3 key-safe URI encoding (RFC 3986, "/" preserved) — SigV4's rules. */
export function encodeS3Path(path: string): string {
  return path
    .split("/")
    .map((seg) =>
      encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join("/");
}

export interface S3Config {
  endpoint: string; // origin, no trailing slash
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config | null {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  return {
    endpoint: S3_ENDPOINT.replace(/\/+$/, ""),
    bucket: S3_BUCKET,
    region: env.S3_REGION || "us-east-1",
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  };
}

export class S3BlobStore implements BlobStore {
  constructor(
    private readonly config: S3Config,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private request(method: "GET" | "PUT", key: string, bytes?: Buffer, contentType?: string) {
    const path = encodeS3Path(`/${this.config.bucket}/${key}`);
    const url = `${this.config.endpoint}${path}`;
    const host = new URL(this.config.endpoint).host;
    const amzDate = this.now().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const payloadHashHex = sha256hex(bytes ?? "");

    const { authorization } = signV4({
      method,
      path,
      host,
      region: this.config.region,
      amzDate,
      payloadHashHex,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      contentType,
    });

    const headers: Record<string, string> = {
      authorization,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHashHex,
    };
    if (contentType) headers["content-type"] = contentType;

    return this.fetchImpl(url, {
      method,
      headers,
      body: bytes ? new Uint8Array(bytes) : undefined,
    });
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<string> {
    const res = await this.request("PUT", key, bytes, contentType);
    if (!res.ok) {
      throw new Error(`S3 put failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    return key;
  }

  async get(key: string): Promise<StoredBlob | null> {
    const res = await this.request("GET", key);
    if (res.status === 404 || res.status === 403) return null; // S3 hides missing keys as 403 without ListBucket
    if (!res.ok) throw new Error(`S3 get failed: ${res.status}`);
    return {
      bytes: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  }
}
