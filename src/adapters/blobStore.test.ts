import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalBlobStore, blobKey, checksumOf } from "./blobStore";

const root = mkdtempSync(join(tmpdir(), "clerk-blobs-"));
const store = new LocalBlobStore(root);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("LocalBlobStore", () => {
  it("round-trips bytes and content type", async () => {
    const bytes = Buffer.from("hello, records office");
    const key = await store.put(blobKey("ag-1", "contract.pdf"), bytes, "application/pdf");

    const got = await store.get(key);
    expect(got).not.toBeNull();
    expect(got!.bytes.equals(bytes)).toBe(true);
    expect(got!.contentType).toBe("application/pdf");
  });

  it("returns null for unknown keys and refuses traversal", async () => {
    expect(await store.get("ag-1/nope")).toBeNull();
    await expect(store.put("../escape", Buffer.from("x"), "text/plain")).rejects.toThrow();
  });

  it("sanitizes hostile filenames into safe keys", () => {
    const key = blobKey("ag-1", "../../etc/passwd");
    expect(key.startsWith("ag-1/")).toBe(true);
    expect(key).not.toContain("..");
    expect(key).not.toContain("/etc");
  });

  it("checksums are stable sha-256 hex", () => {
    const c = checksumOf(Buffer.from("abc"));
    expect(c).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
