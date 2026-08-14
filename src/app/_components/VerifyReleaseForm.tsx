"use client";

/**
 * Release verification form (docs/release-verification.md). The file is
 * fingerprinted IN THE BROWSER with WebCrypto sha-256 — its bytes never
 * leave the visitor's device; only the 64-hex digest goes to the server.
 * A paste-the-hash path covers scripts and machines.
 */
import { useRef, useState, useTransition } from "react";
import { verifyReleaseAction, type VerifyReleaseActionResult } from "../[agency]/actions";

export function VerifyReleaseForm({ agencySlug }: { agencySlug: string }) {
  const [hash, setHash] = useState("");
  const [hashedFile, setHashedFile] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyReleaseActionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const check = (h: string) => {
    startTransition(async () => {
      setResult(await verifyReleaseAction(agencySlug, h));
    });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      setHash(hex);
      setHashedFile(file.name);
      check(hex);
    } catch (e) {
      console.error("hashing failed", e);
      setResult({ ok: false, error: "Could not read that file in this browser." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-pad">
      <div className="panel-title">Verify a document</div>
      <p className="muted" style={{ fontSize: "0.88rem", margin: "6px 0 12px", maxWidth: 560 }}>
        Choose the file exactly as you received it. It is fingerprinted in your browser —
        the file itself is never uploaded — and the fingerprint is checked against this
        office&apos;s release record.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button
          className="btn btn-primary"
          disabled={busy || pending}
          onClick={() => fileInput.current?.click()}
        >
          {busy ? "Fingerprinting…" : "Choose a file to verify"}
        </button>
        <input
          ref={fileInput}
          type="file"
          style={{ display: "none" }}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <span className="muted" style={{ fontSize: "0.82rem" }}>
          or paste a SHA-256 below
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, maxWidth: 640 }}>
        <input
          className="field mono"
          style={{ flex: 1 }}
          placeholder="e.g. 9f86d081884c7d659a2feaa0c55ad015…"
          value={hash}
          onChange={(e) => {
            setHash(e.target.value);
            setHashedFile(null);
          }}
        />
        <button className="btn" disabled={pending || !hash.trim()} onClick={() => check(hash)}>
          {pending ? "Checking…" : "Check"}
        </button>
      </div>

      {result && (
        <div style={{ marginTop: 16 }} role="status">
          {!result.ok ? (
            <p className="pill band-overdue">{result.error}</p>
          ) : result.verified ? (
            <div className="card card-pad" style={{ borderLeft: "3px solid var(--ok)" }}>
              <div style={{ fontWeight: 700 }}>✓ Authentic release</div>
              <p style={{ margin: "6px 0 0", fontSize: "0.9rem" }}>
                {hashedFile ? <span className="mono">{hashedFile}</span> : "This fingerprint"}{" "}
                is byte-identical to <span className="mono">{result.filename}</span>, released by
                this office on {new Date(result.releasedAt).toLocaleDateString()}
                {result.requestPublicId ? (
                  <>
                    {" "}
                    under request <span className="mono">{result.requestPublicId}</span>
                  </>
                ) : null}
                .
              </p>
            </div>
          ) : result.reason === "invalid_hash" ? (
            <p className="muted" style={{ fontSize: "0.88rem" }}>
              That doesn&apos;t look like a full SHA-256 fingerprint (64 hex characters).
            </p>
          ) : (
            <div className="card card-pad">
              <div style={{ fontWeight: 700 }}>No match in the release record</div>
              <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.88rem", maxWidth: 560 }}>
                This is not proof of tampering: any change to the bytes — re-saving, printing to a
                new PDF, an email gateway re-encoding an attachment — produces a different
                fingerprint. Verify the file exactly as delivered, or contact the records office
                with the request&apos;s tracking number.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
