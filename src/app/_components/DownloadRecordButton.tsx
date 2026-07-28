"use client";

import { useState } from "react";
import { logDeflectionAction } from "../[agency]/actions";

/** Archive download — logs the served download as a deflection (§6.7). */
export function DownloadRecordButton({
  agencySlug,
  documentId,
}: {
  agencySlug: string;
  documentId: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={`btn btn-sm ${done ? "" : "btn-primary"}`}
      style={{ marginLeft: "auto" }}
      onClick={() => {
        setDone(true);
        void logDeflectionAction({ agencySlug, kind: "download", documentId });
      }}
    >
      {done ? "✓ Downloaded" : "Download"}
    </button>
  );
}
