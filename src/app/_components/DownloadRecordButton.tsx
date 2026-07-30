"use client";

import { useState } from "react";
import { logDeflectionAction } from "../[agency]/actions";

/**
 * Archive download — a REAL link to the /files gate (which enforces
 * entitlements), logging the served download as a deflection (§6.7).
 * Renders nothing when the entry has no bytes to serve (metadata-only
 * archive entries, the unseeded demo fixture).
 */
export function DownloadRecordButton({
  agencySlug,
  documentId,
  href,
}: {
  agencySlug: string;
  documentId: string;
  href: string | null;
}) {
  const [done, setDone] = useState(false);
  if (!href) return null;
  return (
    <a
      className={`btn btn-sm ${done ? "" : "btn-primary"}`}
      style={{ marginLeft: "auto" }}
      href={href}
      download
      onClick={() => {
        setDone(true);
        // A served download = a request that never needed filing (§6.7 ROI).
        void logDeflectionAction({ agencySlug, kind: "download", documentId });
      }}
    >
      {done ? "✓ Downloaded" : "Download"}
    </a>
  );
}
