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
