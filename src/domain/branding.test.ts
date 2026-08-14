/** Branding rules — the accent contrast guard is the load-bearing part. */
import { describe, expect, it } from "vitest";
import {
  accentForDarkTheme,
  checkAccentColor,
  contrastBetween,
  contrastOnWhiteInk,
  effectiveBranding,
  tenantAccentCss,
} from "./branding";

describe("checkAccentColor", () => {
  it("accepts dark civic colors and normalizes them", () => {
    expect(checkAccentColor("#1e3a5f")).toEqual({ ok: true, normalized: "#1e3a5f" });
    expect(checkAccentColor("990000")).toEqual({ ok: true, normalized: "#990000" });
    expect(checkAccentColor("#036")).toEqual({ ok: true, normalized: "#003366" });
  });

  it("REJECTS colors where white ink fails AA — the unreadable-portal guard", () => {
    for (const light of ["#c9a227" /* civic gold */, "#ffff00", "#ffffff", "#7fd4ff"]) {
      expect(checkAccentColor(light)).toEqual({ ok: false, reason: "too_light" });
    }
  });

  it("rejects garbage", () => {
    for (const bad of ["", "blue", "#12", "#zzzzzz", "rgb(0,0,0)"]) {
      expect(checkAccentColor(bad)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("contrast math is sane: black is 21:1, white is 1:1 against white ink", () => {
    expect(contrastOnWhiteInk("#000000")).toBeCloseTo(21, 0);
    expect(contrastOnWhiteInk("#ffffff")).toBeCloseTo(1, 1);
  });
});

describe("accentForDarkTheme", () => {
  const DARK_PAPER = "#0f141a";

  it("returns an already-dark-safe accent unchanged (the brand's own dark terracotta)", () => {
    expect(accentForDarkTheme("#c46a4a")).toBe("#c46a4a");
  });

  it("lifts every white-ink-passing civic color to AA text on the dark paper", () => {
    // Colors a clerk actually picks: navies, forest green, deep red, plum.
    for (const accent of ["#1e3a5f", "#003366", "#1e5c2f", "#990000", "#4b2a45", "#9c4a2c"]) {
      expect(checkAccentColor(accent).ok).toBe(true); // sanity: valid accents
      const dark = accentForDarkTheme(accent)!;
      expect(contrastBetween(dark, DARK_PAPER)!).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("holds the hue — lightness is the only lever (the anti-salmon rule)", () => {
    // Forest green must stay green: dominant channel unchanged.
    const dark = accentForDarkTheme("#1e5c2f")!;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(dark.slice(i, i + 2), 16));
    expect(g).toBeGreaterThan(r!);
    expect(g).toBeGreaterThan(b!);
  });

  it("rejects garbage", () => {
    expect(accentForDarkTheme("blue")).toBeNull();
  });
});

describe("tenantAccentCss", () => {
  it("emits light values verbatim and a screen-scoped dark override", () => {
    const css = tenantAccentCss("#1e3a5f")!;
    expect(css).toContain(".tenant-accent{--primary:#1e3a5f;--primary-deep:#1e3a5f;--primary-hover:#1e3a5f;}");
    // Dark-locked: the adjusted accent applies on every screen; the base
    // (stored) value survives only for print.
    expect(css).toContain("@media screen{");
    const dark = accentForDarkTheme("#1e3a5f")!;
    expect(css).toContain(`--primary:${dark}`);
    // --primary-deep stays the stored accent in dark too: it is only ever a
    // ground under white ink, which checkAccentColor guarantees.
    expect(css.split("@media")[1]).toContain("--primary-deep:#1e3a5f");
  });

  it("pins the dark-adjusted accent inside the nav for BOTH themes — the bar's ground is always dark", () => {
    const css = tenantAccentCss("#1e3a5f")!;
    const dark = accentForDarkTheme("#1e3a5f")!;
    const navBlock = css.slice(css.indexOf(".tenant-accent .nav{"));
    expect(navBlock).toContain(`--primary:${dark}`);
    expect(navBlock).toContain("--primary-deep:#1e3a5f");
    // Outside any media query: the pin applies to light-theme visitors too.
    expect(css.split("}").at(-2)).toContain(".tenant-accent .nav");
  });

  it("returns null for anything checkAccentColor would refuse — nothing unvetted reaches a <style> tag", () => {
    for (const bad of ["", "blue", "#7fd4ff", "#fff;}body{display:none"]) {
      expect(tenantAccentCss(bad)).toBeNull();
    }
  });
});

describe("effectiveBranding", () => {
  it("defaults the office name but never invents contact details", () => {
    const e = effectiveBranding(null);
    expect(e.officeName).toBe("Office of the City Clerk");
    expect(e.contactEmail).toBeNull();
    expect(e.addressLines).toEqual([]);
    expect(e.hours).toBeNull();
    expect(e.hasCustomSeal).toBe(false);
  });

  it("uses what the clerk provided, trimmed and cleaned", () => {
    const e = effectiveBranding({
      officeName: "  Records Division ",
      contactEmail: "records@cedarfalls.gov",
      addressLines: [" 12 Main St ", "", "Cedar Falls, WA"],
      sealBlobRef: "blob-1",
    });
    expect(e.officeName).toBe("Records Division");
    expect(e.contactEmail).toBe("records@cedarfalls.gov");
    expect(e.addressLines).toEqual(["12 Main St", "Cedar Falls, WA"]);
    expect(e.hasCustomSeal).toBe(true);
  });
});
