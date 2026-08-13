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

/**
 * Municipal seal — the official mark used in the banner, letterhead, and
 * footer. Pure SVG on the civic palette: navy disc, double gold ring with a
 * rope inner ring, star, and laurel arc.
 */
export function Seal({ size = 34, label }: { size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ flex: "none" }}
    >
      <circle cx="32" cy="32" r="31" fill="var(--primary-deep)" />
      <circle cx="32" cy="32" r="27.5" fill="none" stroke="var(--gold)" strokeWidth="1.6" />
      <circle cx="32" cy="32" r="23.5" fill="none" stroke="var(--gold)" strokeWidth="0.9" strokeDasharray="2.2 2.6" />
      {/* Central star */}
      <path
        transform="translate(32 30) scale(1.15)"
        fill="var(--gold)"
        d="M0-9 2.02-2.78 8.56-2.78 3.27 1.06 5.29 7.28 0 3.44-5.29 7.28-3.27 1.06-8.56-2.78-2.02-2.78Z"
      />
      {/* Laurel arc */}
      <path d="M17 42 q15 11 30 0" fill="none" stroke="var(--gold)" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M20 44.5 l-2.4 2.6 M32 47.3 l0 3 M44 44.5 l2.4 2.6" stroke="var(--gold)" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * BRANDEIS PRODUCT MARK — the prism.
 *
 * A ray of sunlight enters from the left, strikes a prism, and refracts into
 * a stream of data that resolves into a document. "Sunlight becomes
 * understanding": the reason the product is named for the justice who wrote
 * that sunlight is the best disinfectant.
 *
 * Hand-authored SVG on brand tokens, so it inherits light/dark, scales from a
 * 24px favicon to a hero watermark without artifacts, and adds no binary
 * asset to the bundle. `idPrefix` keeps the gradient ids unique when more
 * than one mark is on a page.
 *
 * NOT the same thing as <Seal>. Seal stands in for a GOVERNMENT's own seal on
 * tenant portals; this stands for the product. Never swap one for the other.
 */
export function BrandMark({
  size = 34,
  label,
  idPrefix = "bm",
  detail,
}: {
  size?: number;
  label?: string;
  idPrefix?: string;
  /** Defaults by size: the 7-ray fan and the page's rule lines turn to mush
   *  below ~36px, so small marks drop them instead of shipping a smudge. */
  detail?: "full" | "compact";
}) {
  const compact = (detail ?? (size < 36 ? "compact" : "full")) === "compact";
  const beam = `${idPrefix}-beam`;
  const glow = `${idPrefix}-glow`;
  const fan = `${idPrefix}-fan`;
  return (
    <svg
      width={size * (128 / 64)}
      height={size}
      viewBox="0 0 128 64"
      fill="none"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ flex: "none", overflow: "visible" }}
    >
      <defs>
        <linearGradient id={beam} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--gold)" stopOpacity="0" />
          <stop offset="0.55" stopColor="var(--gold)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--gold)" stopOpacity="1" />
        </linearGradient>
        <radialGradient id={glow}>
          <stop offset="0" stopColor="var(--gold)" stopOpacity="0.95" />
          <stop offset="1" stopColor="var(--gold)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={fan} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--gold)" stopOpacity="0.95" />
          <stop offset="1" stopColor="var(--gold)" stopOpacity="0.35" />
        </linearGradient>
      </defs>

      {/* incoming ray */}
      <path d="M0 32H30" stroke={`url(#${beam})`} strokeWidth="1.6" strokeLinecap="round" />
      {/* the strike */}
      <circle cx="30" cy="32" r="11" fill={`url(#${glow})`} />
      <circle cx="30" cy="32" r="2.1" fill="var(--gold)" />

      {/* the prism: apex at the point of incidence, base to the right */}
      <path
        d="M30 32 58 5 58 59Z"
        stroke="var(--ink)"
        strokeOpacity="0.55"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />

      {/* refracted fan — solid at the prism, resolving into data further out */}
      <g stroke={`url(#${fan})`} strokeWidth="1.15" strokeLinecap="round">
        <path d="M33 32H92" />
        <path d="M33 32 92 20" strokeDasharray="14 4 7 5" />
        <path d="M33 32 92 44" strokeDasharray="14 4 7 5" />
        {!compact && (
          <>
            <path d="M33 32 88 12" strokeDasharray="10 5 5 6" />
            <path d="M33 32 88 52" strokeDasharray="10 5 5 6" />
            <path d="M33 32 84 7" strokeDasharray="6 6 4 7" opacity="0.75" />
            <path d="M33 32 84 57" strokeDasharray="6 6 4 7" opacity="0.75" />
          </>
        )}
      </g>

      {/* the record the light resolves into: a page with a turned corner */}
      <path
        d="M92 12h20l8 8v32H92z"
        stroke="var(--mark-structure)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M112 12v8h8" stroke="var(--mark-structure)" strokeWidth="1.4" strokeLinejoin="round" />
      {!compact && (
        <g stroke="var(--mark-structure)" strokeWidth="1.3" strokeLinecap="round" opacity="0.85">
          <path d="M98 30h11" />
          <path d="M98 37h16" />
          <path d="M98 44h8" />
        </g>
      )}
    </svg>
  );
}

/**
 * The full product lockup: prism + BRANDEIS + optional tagline. Horizontal by
 * default, stacked for hero use — the two arrangements the board specifies.
 */
export function BrandLockup({
  size = 30,
  tagline = true,
  stack = false,
  idPrefix = "lk",
}: {
  size?: number;
  tagline?: boolean;
  stack?: boolean;
  idPrefix?: string;
}) {
  return (
    <span className={`brand-lockup${stack ? " brand-lockup-stack" : ""}`}>
      <BrandMark size={size} idPrefix={idPrefix} />
      <span>
        <span className="brand-wordmark" style={{ fontSize: size * 0.72 }}>
          Brandeis
        </span>
        {tagline && <span className="brand-tagline">AI for public records</span>}
      </span>
    </span>
  );
}

/** Small classical-building glyph for the official-website banner. */
export function CivicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2 2 8v1.6h20V8L12 2z" />
      <path d="M4 11h3v8H4zM10.5 11h3v8h-3zM17 11h3v8h-3zM2 20.5h20V22H2z" />
    </svg>
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
