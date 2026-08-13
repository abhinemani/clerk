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
  detail?: "full" | "compact";
}) {
  /**
   * Redrawn 2026-08-13 from the owner's high-res renders (light + dark).
   * Geometry taken off those: apex-left prism with a vertical right face,
   * a long beam arriving from off-frame, a fan of SEVEN fine rays that
   * crosses the prism interior and resolves into the data rows of a record.
   *
   * Three colour roles, because the renders use three:
   *   --mark-beam      the arriving sunlight (gold in both styles)
   *   --mark-ray       the refracted fan (silver on dark, amber on light)
   *   --mark-structure prism + record outline + data rows
   *
   * SCALE. The viewBox is 72 tall and the mark renders at `size`, so strokes
   * scale by size/72 — 0.36x in the nav. Seven fine rays and a row of data
   * dashes cannot survive that, so `compact` keeps the silhouette (beam,
   * flare, prism, three rays, record) and drops what would turn to mush. The
   * hero render is the full variant; the nav gets an honest reduction of it,
   * not a different mark.
   */
  // Threshold is 30, not 56. The header runs at 40px and the console at 36,
  // and at those sizes the detail DOES survive — the previous 56 meant every
  // real placement silently got the reduction, so the dashed fan and the
  // record's data rows never appeared anywhere on the site. Compact is now
  // reserved for genuinely tiny marks (favicon scale).
  const compact = (detail ?? (size < 30 ? "compact" : "full")) === "compact";
  // Widths are in viewBox units against a 72-tall box, so at the 40px header
  // the full set lands at ~0.9-1.3 CSS px — thin on purpose, but above the
  // sub-pixel floor that erased the mark the first time.
  const wBeam = compact ? 3.2 : 2.4;
  const wRay = compact ? 2.6 : 1.7;
  const wStruct = compact ? 3.0 : 2.2;

  const beam = `${idPrefix}-beam`;
  const flare = `${idPrefix}-flare`;
  const glass = `${idPrefix}-glass`;

  // Ray fan: apex -> the record's left edge. Full shows seven; compact three.
  const fan = compact ? [26, 36, 46] : [20, 25.5, 31, 36, 41, 46.5, 52];

  return (
    <svg
      width={size * (128 / 72)}
      height={size}
      viewBox="0 0 128 72"
      fill="none"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ flex: "none", overflow: "visible" }}
    >
      <defs>
        <linearGradient id={beam} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--mark-beam)" stopOpacity="0.1" />
          <stop offset="0.55" stopColor="var(--mark-beam)" stopOpacity="0.8" />
          <stop offset="1" stopColor="var(--mark-beam)" stopOpacity="1" />
        </linearGradient>
        <radialGradient id={flare}>
          <stop offset="0" stopColor="var(--mark-beam)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--mark-beam)" stopOpacity="0" />
        </radialGradient>
        {/* the prism reads as glass in the renders, not as a filled shape */}
        <linearGradient id={glass} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--mark-ray)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--mark-ray)" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {/* the arriving ray — long, from off-frame, as in the renders */}
      <path d="M0 36H46" stroke={`url(#${beam})`} strokeWidth={wBeam} strokeLinecap="round" />
      <circle cx="46" cy="36" r="15" fill={`url(#${flare})`} />

      {/* prism: apex at the point of incidence, vertical right face */}
      <path d="M46 36 70 8 70 64Z" fill={`url(#${glass})`} />
      <path
        d="M46 36 70 8 70 64Z"
        stroke="var(--mark-structure)"
        strokeWidth={wStruct}
        strokeLinejoin="round"
      />

      {/* Refracted fan. In the renders the rays leave the prism solid and
          BREAK INTO SEGMENTS as they approach the record — light becoming
          data. That dash pattern is the mark's whole idea, so only the
          central ray stays continuous; the rest dash progressively. */}
      <g stroke="var(--mark-ray)" strokeWidth={wRay} strokeLinecap="round">
        {fan.map((y, i) => (
          <path
            key={y}
            d={`M47 36 100 ${y}`}
            strokeDasharray={compact || y === 36 ? undefined : i % 2 === 0 ? "20 3 8 3 5 3" : "16 3 6 3 4 3"}
          />
        ))}
      </g>

      {/* the flare core sits ON TOP of the fan so the origin stays a point */}
      <circle cx="46" cy="36" r={compact ? 3.2 : 2.4} fill="var(--mark-beam)" />

      {/* the record the light resolves into: rounded, top-right corner turned */}
      <path
        d="M105 14H117L126 23V57A5 5 0 0 1 121 62H105A5 5 0 0 1 100 57V19A5 5 0 0 1 105 14Z"
        stroke="var(--mark-structure)"
        strokeWidth={wStruct}
        strokeLinejoin="round"
      />
      <path
        d="M117 14V23H126"
        stroke="var(--mark-structure)"
        strokeWidth={wStruct}
        strokeLinejoin="round"
      />

      {/* the fan becoming data — same rows the rays arrive on */}
      {!compact && (
        <g stroke="var(--mark-structure)" strokeWidth="1.9" strokeLinecap="round">
          <path d="M105 20h6M114 20h4" />
          <path d="M105 25.5h10" />
          <path d="M105 31h5M112 31h7" />
          <path d="M105 36h12" />
          <path d="M105 41h4M111 41h6" />
          <path d="M105 46.5h9" />
          <path d="M105 52h6M113 52h4" />
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
  // Size drives a CSS custom property rather than fixed attributes, so the
  // whole lockup scales from one number — and it is a clamp(), so a narrow
  // viewport shrinks it automatically instead of overflowing the nav (which
  // is exactly how the header broke at 390px once already).
  const style = {
    "--lockup": `clamp(${Math.round(size * 0.72)}px, 4.2vw, ${size}px)`,
  } as React.CSSProperties;
  return (
    <span className={`brand-lockup${stack ? " brand-lockup-stack" : ""}`} style={style}>
      <BrandMark size={size} idPrefix={idPrefix} />
      <span>
        <span className="brand-wordmark">Brandeis</span>
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
