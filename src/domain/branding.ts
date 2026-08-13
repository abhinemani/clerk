/**
 * Per-tenant branding rules (pure).
 *
 * The accent color replaces the portal's navy (--primary), which carries
 * WHITE ink on buttons and the nav — so an accent is only accepted when
 * white text on it clears WCAG AA for normal text (4.5:1). That guard is the
 * whole reason this module exists: a clerk picking their city's gold must get
 * a clear "too light for text" instead of an unreadable portal.
 */
import type { AgencyBranding } from "@/services/repository";

/** Parse #rgb or #rrggbb into [r,g,b] 0–255, or null. */
function parseHex(input: string): [number, number, number] | null {
  const hex = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return [
      parseInt(hex[0]! + hex[0]!, 16),
      parseInt(hex[1]! + hex[1]!, 16),
      parseInt(hex[2]! + hex[2]!, 16),
    ];
  }
  if (/^[0-9a-f]{6}$/.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return null;
}

/** WCAG relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const chan = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/** Contrast ratio of white text on the given color. */
export function contrastOnWhiteInk(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const l = luminance(rgb);
  return (1.0 + 0.05) / (l + 0.05);
}

export type AccentCheck =
  | { ok: true; normalized: string }
  | { ok: false; reason: "invalid" | "too_light" };

/**
 * Accept an accent only if it's a real hex color AND white ink on it meets
 * AA (≥ 4.5:1). Returns the normalized #rrggbb.
 */
export function checkAccentColor(input: string): AccentCheck {
  const rgb = parseHex(input);
  if (!rgb) return { ok: false, reason: "invalid" };
  const ratio = contrastOnWhiteInk(input)!;
  if (ratio < 4.5) return { ok: false, reason: "too_light" };
  const normalized = `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return { ok: true, normalized };
}

/** Contrast ratio between two hex colors (order-independent). */
export function contrastBetween(hexA: string, hexB: string): number | null {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  if (!a || !b) return null;
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* ---- dark-theme accent derivation ----------------------------------------
 *
 * The tenant accent replaces --primary, which the DARK theme uses as accent
 * TEXT on near-black paper and as a button fill carrying near-black ink
 * (--primary-ink is #0f141a in dark). An accent that passed the white-ink
 * guard is necessarily dark, so used raw in the dark theme it fails both
 * roles. The brand solved this exact problem for terracotta by holding the
 * hue and moving ONLY lightness (#9c4a2c light / #c46a4a dark) — never
 * saturation, which is what turns colors pastel. This derivation applies the
 * same lever mechanically: raise HSL lightness, hue and saturation held,
 * until the color clears AA (4.5:1) against the dark paper. That single
 * floor covers both roles, because the dark button ink IS the dark paper
 * color.
 */

/** The dark theme's --paper (globals.css). Both derived floors key off it. */
const DARK_PAPER = "#0f141a";

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hslToHex([h, s, l]: [number, number, number]): string {
  const hue = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let rgb: [number, number, number];
  if (s === 0) {
    const v = Math.round(l * 255);
    rgb = [v, v, v];
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    rgb = [
      Math.round(hue(p, q, h + 1 / 3) * 255),
      Math.round(hue(p, q, h) * 255),
      Math.round(hue(p, q, h - 1 / 3) * 255),
    ];
  }
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The accent, adjusted for the dark theme: same hue, same saturation,
 * lightness raised just far enough to clear 4.5:1 against the dark paper.
 * A color that already clears comes back unchanged (so a tenant that picks
 * the brand's own dark-safe terracotta keeps it verbatim).
 */
export function accentForDarkTheme(input: string): string | null {
  const rgb = parseHex(input);
  if (!rgb) return null;
  const start = `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  if (contrastBetween(start, DARK_PAPER)! >= 4.5) return start;
  const [h, s, l] = rgbToHsl(rgb);
  // Walk lightness up in small steps; white is 15.7:1 on the dark paper, so
  // the loop always terminates well before l reaches 1.
  for (let lift = l; lift <= 1; lift += 0.01) {
    const candidate = hslToHex([h, s, lift]);
    if (contrastBetween(candidate, DARK_PAPER)! >= 4.5) return candidate;
  }
  return "#ffffff";
}

/**
 * CSS for a tenant accent, correct in BOTH themes. Light theme takes the
 * stored accent verbatim (white-ink-guarded at save). Dark theme swaps
 * --primary/--primary-hover for the lightness-adjusted variant; --primary-deep
 * keeps the stored accent in both themes, because it is only ever a GROUND
 * under white ink — the very thing checkAccentColor guarantees. The dark
 * block is screen-only so printing gets the light values, matching how
 * globals.css scopes its own dark theme.
 *
 * Returns null for anything that is not a valid stored accent — the caller
 * renders no style tag at all rather than an unvetted string (this is the
 * one place tenant data reaches a <style> element).
 */
export function tenantAccentCss(input: string): string | null {
  const check = checkAccentColor(input);
  if (!check.ok) return null;
  const accent = check.normalized;
  const dark = accentForDarkTheme(accent)!;
  const darkHover = accentForDarkTheme(hslLift(dark, 0.07))!;
  return (
    `.tenant-accent{--primary:${accent};--primary-deep:${accent};--primary-hover:${accent};}` +
    `@media screen and (prefers-color-scheme:dark){` +
    `.tenant-accent{--primary:${dark};--primary-hover:${darkHover};--primary-deep:${accent};}` +
    `}` +
    // The nav's ground is pinned dark in BOTH themes (globals.css chrome
    // block), so inside it the accent must be the dark-adjusted variant even
    // for light-theme visitors — the stored accent passed the white-ink
    // guard, which makes it dark, which makes it invisible on the dark bar.
    // Two classes outrank the .nav token pin regardless of order.
    `.tenant-accent .nav{--primary:${dark};--primary-hover:${darkHover};--primary-deep:${accent};}`
  );
}

/** Same hue/saturation, lightness nudged up by `amount` (clamped). */
function hslLift(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [h, s, l] = rgbToHsl(rgb);
  return hslToHex([h, s, Math.min(1, l + amount)]);
}

export interface EffectiveBranding {
  officeName: string;
  /** null = don't render a contact block at all (never invent one). */
  contactEmail: string | null;
  addressLines: string[];
  hours: string | null;
  accentColor: string | null;
  hasCustomSeal: boolean;
}

/**
 * Merge stored branding with honest defaults. The only invented default is
 * the office NAME (a records office always has one); contact details render
 * only when the clerk actually provided them.
 */
export function effectiveBranding(branding: AgencyBranding | null | undefined): EffectiveBranding {
  return {
    officeName: branding?.officeName?.trim() || "Office of the City Clerk",
    contactEmail: branding?.contactEmail?.trim() || null,
    addressLines: (branding?.addressLines ?? []).map((l) => l.trim()).filter(Boolean),
    hours: branding?.hours?.trim() || null,
    accentColor: branding?.accentColor ?? null,
    hasCustomSeal: branding?.sealBlobRef != null,
  };
}
