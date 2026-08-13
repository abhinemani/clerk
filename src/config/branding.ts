/**
 * Product branding — the single place to rename the product (spec §1: "keep branding
 * in one config file"). Per-agency branding (logo/colors) lives on the Agency
 * row (§5); this is the platform-level product identity.
 */
export const branding = {
  productName: "Holmes",
  tagline: "An AI-native public records request platform",
  supportEmail: "support@holmes.example",
} as const;

export type Branding = typeof branding;
