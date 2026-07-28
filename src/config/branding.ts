/**
 * Product branding — the single place to rename "Clerk" (spec §1: "keep branding
 * in one config file"). Per-agency branding (logo/colors) lives on the Agency
 * row (§5); this is the platform-level product identity.
 */
export const branding = {
  productName: "Clerk",
  tagline: "An AI-native public records request platform",
  supportEmail: "support@clerk.example",
} as const;

export type Branding = typeof branding;
