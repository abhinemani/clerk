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
  detail?: "full" | "compact";
}) {
  /**
   * Redrawn 2026-08-13 (rev 3) against all four of the owner's renders,
   * taking what is consistent across them. Three things the earlier drafts
   * got wrong, all visible once the renders are compared side by side:
   *
   *  - The record is NOT a closed rectangle. It is a bracket, OPEN on the
   *    left, so the rays run into it and become its contents. Closing it
   *    turned the mark into three separate objects.
   *  - The prism is glass with THICKNESS: a back edge sits inside the right
   *    face, and the lit top edge reads brighter than the body.
   *  - The fan CHANGES COLOUR. Rays leave the prism cool/silver and turn
   *    gold as they enter the record — light literally becoming data, which
   *    is the whole idea of the mark.
   *
   * Detail is the point here, so `compact` is reserved for favicon scale.
   */
  const compact = (detail ?? (size < 26 ? "compact" : "full")) === "compact";
  const wBeam = compact ? 3.4 : 2.3;
  const wRay = compact ? 2.6 : 1.5;
  const wStruct = compact ? 3.2 : 2.0;
  const wData = compact ? 2.6 : 1.9;

  const beam = `${idPrefix}-beam`;
  const halo = `${idPrefix}-halo`;
  const flare = `${idPrefix}-flare`;
  const streak = `${idPrefix}-streak`;
  const glass = `${idPrefix}-glass`;

  /** Fan geometry: apex -> the bracket's open mouth. */
  const APEX = { x: 42, y: 48 };
  const MOUTH = 106;
  const rays = compact
    ? [36, 48, 60]
    : [28, 33.5, 39, 44, 48, 52, 57, 62.5, 68];

  /** Data rows inside the record, at the y values the rays arrive on. */
  const rows: Array<[number, Array<[number, number]>]> = [
    [31, [[112, 7], [122, 5]]],
    [37, [[112, 12]]],
    [43, [[112, 6], [121, 8]]],
    [49, [[112, 15]]],
    [55, [[112, 5], [120, 6], [129, 4]]],
    [61, [[112, 11]]],
    [67, [[112, 7], [122, 6]]],
  ];

  return (
    <svg
      width={size * (160 / 96)}
      height={size}
      viewBox="0 0 160 96"
      fill="none"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ flex: "none", overflow: "visible" }}
    >
      <defs>
        <linearGradient id={beam} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--mark-beam)" stopOpacity="0.35" />
          <stop offset="0.45" stopColor="var(--mark-beam)" stopOpacity="0.85" />
          <stop offset="1" stopColor="var(--mark-beam)" stopOpacity="1" />
        </linearGradient>
        <linearGradient id={halo} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--mark-beam)" stopOpacity="0" />
          <stop offset="0.55" stopColor="var(--mark-beam)" stopOpacity="0.2" />
          <stop offset="1" stopColor="var(--mark-beam)" stopOpacity="0.4" />
        </linearGradient>
        <radialGradient id={flare}>
          <stop offset="0" stopColor="var(--mark-beam)" stopOpacity="0.92" />
          <stop offset="1" stopColor="var(--mark-beam)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={streak}>
          <stop offset="0" stopColor="var(--mark-beam)" stopOpacity="0.7" />
          <stop offset="0.5" stopColor="var(--mark-beam)" stopOpacity="0.14" />
          <stop offset="1" stopColor="var(--mark-beam)" stopOpacity="0" />
        </radialGradient>
        {/* Glass body: brighter along the lit top face, falling away below. */}
        <linearGradient id={glass} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="var(--mark-ray)" stopOpacity="0.34" />
          <stop offset="0.5" stopColor="var(--mark-ray)" stopOpacity="0.13" />
          <stop offset="1" stopColor="var(--mark-ray)" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* ---- the arriving ray ---- */}
      <path d="M0 48H42" stroke={`url(#${halo})`} strokeWidth={wBeam * 2.4} strokeLinecap="round" />
      <path d="M0 48H42" stroke={`url(#${beam})`} strokeWidth={wBeam} strokeLinecap="round" />
      <ellipse cx="36" cy="48" rx="46" ry="5.5" fill={`url(#${streak})`} />

      {/* ---- prism: glass body, back edge, lit top face ---- */}
      <path d="M42 48 76 12 76 84Z" fill={`url(#${glass})`} />
      {!compact && (
        <path
          d="M69 19.6V76.4"
          stroke="var(--mark-structure)"
          strokeWidth={wStruct * 0.6}
          strokeOpacity="0.5"
          strokeLinecap="round"
        />
      )}
      <path
        d="M42 48 76 12 76 84Z"
        stroke="var(--mark-structure)"
        strokeWidth={wStruct}
        strokeLinejoin="round"
      />
      {!compact && (
        <path
          d="M42 48 76 12"
          stroke="var(--mark-ray)"
          strokeWidth={wStruct * 0.55}
          strokeOpacity="0.75"
          strokeLinecap="round"
        />
      )}

      {/* ---- refracted fan: cool leaving the prism, warming into the record ---- */}
      <g strokeWidth={wRay} strokeLinecap="round">
        {rays.map((y, i) => {
          const mid = i === Math.floor(rays.length / 2);
          return (
            <path
              key={y}
              d={`M${APEX.x + 1} ${APEX.y} ${MOUTH} ${y}`}
              stroke={i % 3 === 2 ? "var(--mark-beam)" : "var(--mark-ray)"}
              strokeOpacity={mid ? 1 : 0.82}
              strokeDasharray={
                compact || mid ? undefined : i % 2 === 0 ? "26 3 9 3 5 3" : "21 3 7 3 4 3"
              }
            />
          );
        })}
      </g>

      {/* flare core sits above the fan so the origin stays a point */}
      <circle cx="42" cy="48" r={compact ? 13 : 11} fill={`url(#${flare})`} />
      <circle cx="42" cy="48" r={compact ? 3.4 : 2.5} fill="var(--mark-beam)" />

      {/* ---- the record: a bracket, OPEN on the left, corner turned ---- */}
      <path
        d="M104 24H134L144 34V72H104"
        stroke="var(--mark-beam)"
        strokeWidth={wStruct}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {!compact && (
        <path
          d="M134 24V34H144"
          stroke="var(--mark-beam)"
          strokeWidth={wStruct * 0.7}
          strokeOpacity="0.75"
          strokeLinejoin="round"
        />
      )}

      {/* ---- the fan, become data ---- */}
      {!compact && (
        <g strokeWidth={wData} strokeLinecap="round">
          {rows.map(([y, segs], ri) =>
            segs.map(([x, len], si) => (
              <path
                key={`${y}-${x}`}
                d={`M${x} ${y}h${len}`}
                stroke={(ri + si) % 3 === 1 ? "var(--mark-ray)" : "var(--mark-beam)"}
                strokeOpacity={(ri + si) % 3 === 1 ? 0.7 : 0.95}
              />
            )),
          )}
          {/* a few solid blocks, as in the renders */}
          <g fill="var(--mark-beam)" fillOpacity="0.85" stroke="none">
            <rect x="126" y="35.2" width="3.6" height="3.6" rx="0.6" />
            <rect x="132" y="47.2" width="3.6" height="3.6" rx="0.6" />
            <rect x="126" y="59.2" width="3.6" height="3.6" rx="0.6" />
          </g>
        </g>
      )}
    </svg>
  );
}

/**
 * The approved mark as ARTWORK, for headers.
 *
 * Two revisions swapped by theme, which is correct here because a nav's
 * ground follows the visitor — unlike the footer, whose ground is dark in
 * both themes and therefore pins one revision. Cropped from the owner's
 * lockups and downscaled to 132px tall, covering a 40px slot at 3x.
 *
 * Use this wherever the mark appears at header size: it is the approved
 * artwork, and one mark everywhere beats two drawings of the same idea.
 * <BrandMark> (SVG) stays for standalone/decorative placements, where it can
 * run larger and recolour from tokens.
 */
export function BrandMarkRaster({ alt = "" }: { alt?: string }) {
  return (
    <picture className="brand-raster">
      <source srcSet="/brand/mark-dark.png" media="(prefers-color-scheme: dark)" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/mark-light.png" alt={alt} />
    </picture>
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
}: {
  size?: number;
  tagline?: boolean;
  stack?: boolean;
}) {
  // Size drives a CSS custom property rather than fixed attributes, so the
  // whole lockup scales from one number — and it is a clamp(), so a narrow
  // viewport shrinks it automatically instead of overflowing the nav (which
  // is exactly how the header broke at 390px once already).
  const style = {
    "--lockup": `clamp(${Math.round(size * 0.72)}px, 4.2vw, ${size}px)`,
  } as React.CSSProperties;
  return (
    <span className={`brand-lockup${stack ? " brand-lockup-stack" : ""}`} style={style}>
      {/* The approved artwork, not a redraw of it. No idPrefix needed: a
          raster has no gradient ids to collide when the lockup appears twice
          on a page. <BrandMark> stays for placements that run large enough to
          show the SVG's detail and want token recolouring. */}
      <BrandMarkRaster />
      <span>
        <span className="brand-wordmark">Brandeis</span>
        {tagline && <span className="brand-tagline">{branding.tagline}</span>}
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
