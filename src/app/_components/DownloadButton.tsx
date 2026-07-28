"use client";

/** Client-side CSV download (§11 "one-click CSV export"). */
export function DownloadButton({ filename, content, label }: { filename: string; content: string; label: string }) {
  function download() {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button className="btn btn-sm" onClick={download}>
      {label}
    </button>
  );
}
