import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { branding } from "@/config/branding";

export const metadata: Metadata = {
  title: `${branding.productName} — ${branding.tagline}`,
  description: branding.tagline,
};

/**
 * Root layout is deliberately bare: the marketing site (/), agency portals
 * (/[agency]) and the platform console (/admin) each bring their own chrome.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
