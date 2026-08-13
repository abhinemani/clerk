/**
 * S3 adapter tests. The signing math is pinned against AWS's PUBLISHED SigV4
 * example (docs: "Authenticating Requests (AWS Signature Version 4) —
 * example: GET object"), so a refactor that breaks a single byte of the
 * canonical request fails loudly here rather than as a 403 in production.
 */
import { describe, expect, it } from "vitest";
import { encodeS3Path, S3BlobStore, s3ConfigFromEnv, signV4 } from "./s3BlobStore";

describe("signV4 — AWS published example", () => {
  // From AWS docs: GET /test.txt on examplebucket, 2013-05-24, us-east-1,
  // empty payload, access key AKIAIOSFODNN7EXAMPLE.
  const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  it("reproduces AWS's documented GET-object signature byte-for-byte", () => {
    // docs.aws.amazon.com "Signature Calculations … Example: GET Object":
    // GET /test.txt on examplebucket with Range: bytes=0-9.
    const { authorization } = signV4({
      method: "GET",
      path: "/test.txt",
      host: "examplebucket.s3.amazonaws.com",
      region: "us-east-1",
      amzDate: "20130524T000000Z",
      payloadHashHex: EMPTY_SHA,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      extraHeaders: { range: "bytes=0-9" },
    });
    expect(authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("changes the signature when any input changes", () => {
    const base = {
      method: "GET" as const,
      path: "/test.txt",
      host: "h",
      region: "us-east-1",
      amzDate: "20130524T000000Z",
      payloadHashHex: EMPTY_SHA,
      accessKeyId: "AK",
      secretAccessKey: "SK",
    };
    const sig = (i: typeof base) => signV4(i).authorization.split("Signature=")[1];
    expect(sig({ ...base, path: "/other.txt" })).not.toBe(sig(base));
    expect(sig({ ...base, region: "eu-west-1" })).not.toBe(sig(base));
    expect(sig({ ...base, secretAccessKey: "SK2" })).not.toBe(sig(base));
  });
});

describe("encodeS3Path", () => {
  it("encodes per RFC 3986 while preserving slashes", () => {
    expect(encodeS3Path("/bucket/ag-1/my file (1).pdf")).toBe("/bucket/ag-1/my%20file%20%281%29.pdf");
    expect(encodeS3Path("/b/a+b*c'd!e")).toBe("/b/a%2Bb%2Ac%27d%21e");
  });
});

describe("s3ConfigFromEnv", () => {
  it("returns null unless every required var is set (self-contained default)", () => {
    expect(s3ConfigFromEnv({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(s3ConfigFromEnv({ S3_ENDPOINT: "http://x", S3_BUCKET: "b" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    const full = s3ConfigFromEnv({
      S3_ENDPOINT: "http://localhost:9000/",
      S3_BUCKET: "brandeis",
      S3_ACCESS_KEY_ID: "ak",
      S3_SECRET_ACCESS_KEY: "sk",
    } as unknown as NodeJS.ProcessEnv);
    expect(full).toMatchObject({ endpoint: "http://localhost:9000", region: "us-east-1" });
  });
});

describe("S3BlobStore request shape (fake fetch)", () => {
  const config = {
    endpoint: "http://localhost:9000",
    bucket: "brandeis",
    region: "us-east-1",
    accessKeyId: "ak",
    secretAccessKey: "sk",
  };

  it("PUT sends signed headers + body to the path-style URL", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const store = new S3BlobStore(config, fakeFetch, () => new Date("2026-08-04T12:00:00Z"));

    await store.put("ag-1/report.pdf", Buffer.from("hello"), "application/pdf");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://localhost:9000/brandeis/ag-1/report.pdf");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-amz-date"]).toBe("20260804T120000Z");
    expect(headers["content-type"]).toBe("application/pdf");
    expect(headers.authorization).toContain("Credential=ak/20260804/us-east-1/s3/aws4_request");
    expect(headers.authorization).toContain("content-type;host;x-amz-content-sha256;x-amz-date");
  });

  it("GET returns bytes+contentType, null on 404 AND 403 (S3 masks missing keys)", async () => {
    const responses = [
      new Response(Buffer.from("data"), { status: 200, headers: { "content-type": "text/plain" } }),
      new Response(null, { status: 404 }),
      new Response(null, { status: 403 }),
    ];
    const fakeFetch = (async () => responses.shift()!) as typeof fetch;
    const store = new S3BlobStore(config, fakeFetch);

    const hit = await store.get("k");
    expect(hit?.bytes.toString()).toBe("data");
    expect(hit?.contentType).toBe("text/plain");
    expect(await store.get("k")).toBeNull();
    expect(await store.get("k")).toBeNull();
  });

  it("PUT failure surfaces the S3 error body", async () => {
    const fakeFetch = (async () =>
      new Response("<Error>AccessDenied</Error>", { status: 403 })) as typeof fetch;
    const store = new S3BlobStore(config, fakeFetch);
    await expect(store.put("k", Buffer.from("x"), "text/plain")).rejects.toThrow(/403.*AccessDenied/s);
  });
});
