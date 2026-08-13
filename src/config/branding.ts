/**
 * Product branding — the single place to rename the product (spec §1: "keep branding
 * in one config file"). Per-agency branding (logo/colors) lives on the Agency
 * row (§5); this is the platform-level product identity.
 */
export const branding = {
  productName: "Brandeis",
  tagline: "AI for FOIA",
  supportEmail: "support@brandeis.us",
  domain: "brandeis.us",
} as const;

export type Branding = typeof branding;
