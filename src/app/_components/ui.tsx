/** Presentational primitives usable from both server and client components. */
import type { ReactNode } from "react";
import type { RiskBand } from "@/domain/deadlineRisk";
import { initials } from "@/lib/format";

export function DeadlineBand({ band, label }: { band: RiskBand; label: string }) {
  return (
    <span className={`pill band-${band}`}>
      <span className="dot" aria-hidden />
      {label}
    </span>
  );
}

export function StatusPill({ label }: { label: string }) {
  return <span className="pill">{label}</span>;
}

export function AiPill({ children }: { children: ReactNode }) {
  return (
    <span className="pill pill-ai">
      <SparkIcon />
      {children}
    </span>
  );
}

export function Avatar({ name, tone = "neutral" }: { name: string; tone?: "neutral" | "primary" }) {
  const style =
    tone === "primary"
      ? { background: "var(--primary-tint)", color: "var(--primary)" }
      : undefined;
  return (
    <span className="avatar" style={style} title={name} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function SparkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2z" />
    </svg>
  );
}

export function RiskMeter({ score, band }: { score: number; band: RiskBand }) {
  const color =
    band === "overdue" ? "var(--overdue)" : band === "due_soon" ? "var(--due)" : "var(--ok)";
  return (
    <div className="risk-bar" title={`Risk ${(score * 100).toFixed(0)}%`}>
      <div className="risk-fill" style={{ width: `${Math.max(6, score * 100)}%`, background: color }} />
    </div>
  );
}
