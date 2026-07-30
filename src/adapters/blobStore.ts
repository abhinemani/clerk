/**
 * Blob storage port (spec §4: object storage behind an interface).
 *
 * LocalBlobStore fits the turnkey deploy exactly like PGlite does: bytes live
 * under BLOB_PATH (a mounted volume in a container deploy) or ./.blobdata in
 * dev — no external service. An S3/MinIO adapter implements the same three
 * methods against @aws-sdk/client-s3 when a deployment outgrows one machine;
 * nothing above this file changes.
 *
 * Keys are namespaced by agency (`{agencyId}/{...}`) — the caller builds
 * them; this layer only guarantees safe filesystem mapping.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

export interface StoredBlob {
  bytes: Buffer;
  contentType: string;
}

export interface BlobStore {
  /** Store bytes; returns the key it was stored under. */
  put(key: string, bytes: Buffer, contentType: string): Promise<string>;
  /** Fetch a blob, or null when the key doesn't exist. */
  get(key: string): Promise<StoredBlob | null>;
}

/** sha-256 hex of blob bytes — the checksum recorded on documents/releases. */
export function checksumOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Build a collision-proof, traversal-proof storage key. */
export function blobKey(agencyId: string, filename: string): string {
  const safe =
    filename
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/\.{2,}/g, ".") // no ".." sequences, even inert ones
      .slice(0, 120) || "file";
  return `${agencyId}/${randomUUID().slice(0, 8)}-${safe}`;
}

export class LocalBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    // Keys come from blobKey() and are stored verbatim; anything with a
    // traversal shape is hostile input — reject, don't repair.
    if (key.includes("..") || key.startsWith("/") || key.includes("\\")) {
      throw new Error("Invalid blob key");
    }
    const abs = join(this.root, normalize(key));
    if (!abs.startsWith(normalize(this.root))) throw new Error("Invalid blob key");
    return abs; // metadata sidecar lives at `${abs}.meta`
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<string> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    await writeFile(`${path}.meta`, contentType, "utf8");
    return key;
  }

  async get(key: string): Promise<StoredBlob | null> {
    try {
      const path = this.pathFor(key);
      const [bytes, contentType] = await Promise.all([
        readFile(path),
        readFile(`${path}.meta`, "utf8").catch(() => "application/octet-stream"),
      ]);
      return { bytes, contentType };
    } catch {
      return null;
    }
  }
}

interface BlobGlobal {
  __clerkBlobStore?: BlobStore;
}
const g = globalThis as BlobGlobal;

/** The app's blob store — one instance per process (Next bundles share it). */
export function getBlobStore(): BlobStore {
  if (!g.__clerkBlobStore) {
    const root = process.env.BLOB_PATH ?? join(process.cwd(), ".blobdata");
    g.__clerkBlobStore = new LocalBlobStore(root);
  }
  return g.__clerkBlobStore;
}
