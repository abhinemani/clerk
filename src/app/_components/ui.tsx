/** Presentational primitives usable from both server and client components. */
import type { ReactNode } from "react";
import type { RiskBand } from "@/domain/deadlineRisk";
import { initials } from "@/lib/format";
import { branding } from "@/config/branding";

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
 * The mark as ARTWORK — the prism cropped from the owner's lockup renders.
 *
 * The mark and lockup are the OWNER'S RASTER RENDERS, verbatim (owner
 * directive 2026-08-13: the images ARE the logo — no re-typeset wordmark, no
 * vector redraw; the old hand-authored SVG mark was removed with that
 * directive). Two revisions swapped by the visitor's theme; both carry a
 * real alpha channel so they sit on any ground. Grounds that are dark in
 * BOTH themes (the marketing footer) pin the dark revision instead — swap
 * on the GROUND, not the theme. Even the favicon (src/app/icon.png) is a
 * crop of the render now — nothing hand-drawn survives; see
 * public/brand/README.md for the regeneration recipe.
 */
export function BrandMarkRaster({
  alt = "",
  size,
  ground = "auto",
}: {
  alt?: string;
  size?: number;
  /** "auto" swaps revisions on the visitor's theme; "dark" pins the dark
   *  revision for grounds that are dark in both themes (the pinned nav). */
  ground?: "auto" | "dark";
}) {
  const imgStyle = size ? { height: size, width: "auto" as const } : undefined;
  if (ground === "dark") {
    return (
      <span className="brand-raster">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mark-dark.png" alt={alt} style={imgStyle} />
      </span>
    );
  }
  return (
    <picture className="brand-raster">
      <source srcSet="/brand/mark-dark.png" media="(prefers-color-scheme: dark)" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/mark-light.png" alt={alt} style={imgStyle} />
    </picture>
  );
}

/**
 * The full product lockup — the owner's approved artwork VERBATIM (mark,
 * wordmark, and tagline are pixels of one render; owner directive 2026-08-13:
 * the raster lockups are the logo, nothing re-typeset, no vector redraw).
 * Light/dark revisions swap on the visitor's theme; both ship a real alpha
 * channel so they sit on any ground. On phone widths the marketing nav
 * swaps to the mark-only crop via CSS — same artwork, tighter crop.
 */
export function BrandLockup({ size = 30 }: { size?: number }) {
  // Size drives a CSS custom property rather than fixed attributes, so the
  // whole lockup scales from one number — and it is a clamp(), so a narrow
  // viewport shrinks it automatically instead of overflowing the nav (which
  // is exactly how the header broke at 390px once already).
  const style = {
    "--lockup": `clamp(${Math.round(size * 0.72)}px, 4.2vw, ${size}px)`,
  } as React.CSSProperties;
  const alt = `${branding.productName} — ${branding.tagline}`;
  // DARK REVISIONS, PINNED — every lockup placement is a nav, and the nav's
  // ground is pinned dark in both themes (see the .nav chrome block in
  // globals.css). Swap on the GROUND, not the theme: a theme swap here put
  // the navy wordmark on the dark bar for light-OS visitors.
  return (
    <span className="brand-lockup" style={style}>
      <span className="brand-raster brand-lockup-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/brandeis-lockup-dark.png" alt={alt} />
      </span>
      {/* Hidden until the ≤640px collapse — the alt lives on whichever
          rendition is visible, and the nav link's aria-label still names
          the product either way. */}
      <span className="brand-raster brand-lockup-mark">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mark-dark.png" alt={alt} />
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
