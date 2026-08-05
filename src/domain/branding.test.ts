/** Branding rules — the accent contrast guard is the load-bearing part. */
import { describe, expect, it } from "vitest";
import { checkAccentColor, contrastOnWhiteInk, effectiveBranding } from "./branding";

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
